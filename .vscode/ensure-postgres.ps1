# Ensures the local Dokploy Swarm Postgres service is up and query-ready.
# Local .env uses host port 5434 (Windows often already binds 5432).
# Note: Docker Desktop may keep TCP 5434 open even at 0 replicas, so we
# verify a running container + pg_isready — not just a TCP connect.
$ErrorActionPreference = "Stop"

$ServiceName = "dokploy-postgres"
$HostPort = 5434
$WaitSeconds = 90

function Get-RunningPostgresContainerId {
	docker ps --filter "name=$ServiceName" --filter "status=running" -q |
		Select-Object -First 1
}

function Test-PostgresReady {
	$id = Get-RunningPostgresContainerId
	if (-not $id) {
		return $false
	}
	docker exec $id pg_isready -U dokploy | Out-Null
	return ($LASTEXITCODE -eq 0)
}

if (Test-PostgresReady) {
	Write-Host "Postgres already ready (service running, pg_isready ok)"
	exit 0
}

$existing = docker service ls --filter "name=$ServiceName" --format "{{.Name}}"
if (-not $existing) {
	Write-Error "Swarm service '$ServiceName' not found. Run task 'Dokploy: Setup' once first."
	exit 1
}

$portsJson = docker service inspect $ServiceName --format "{{json .Spec.EndpointSpec.Ports}}"
if ($portsJson -notmatch '"PublishedPort":\s*5434') {
	Write-Host "Publishing $ServiceName on host port $HostPort..."
	docker service update --publish-add "published=$HostPort,target=5432,mode=host,protocol=tcp" $ServiceName | Out-Null
	if ($LASTEXITCODE -ne 0) {
		exit $LASTEXITCODE
	}
}

Write-Host "Scaling $ServiceName to 1 replica..."
docker service scale "${ServiceName}=1" | Out-Null
if ($LASTEXITCODE -ne 0) {
	exit $LASTEXITCODE
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while (-not (Test-PostgresReady)) {
	if ((Get-Date) -gt $deadline) {
		Write-Error "Timed out after ${WaitSeconds}s waiting for $ServiceName (pg_isready)"
		exit 1
	}
	Write-Host "Waiting for $ServiceName to become ready..."
	Start-Sleep -Seconds 2
}

Write-Host "Postgres is ready on localhost:$HostPort"
exit 0
