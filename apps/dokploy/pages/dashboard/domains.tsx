import { IS_CLOUD, validateRequest } from "@dokploy/server"
import { createServerSideHelpers } from "@trpc/react-query/server"
import type { GetServerSidePropsContext } from "next"
import type { ReactElement } from "react"
import superjson from "superjson"
import { DomainsHub } from "@/components/dashboard/domains/domains-hub"
import { DashboardLayout } from "@/components/layouts/dashboard-layout"
import { appRouter } from "@/server/api/root"

const Page = () => {
	return (
		<div className="flex flex-col gap-4 w-full">
			<DomainsHub />
		</div>
	)
}

export default Page

Page.getLayout = (page: ReactElement) => {
	return <DashboardLayout metaName="Domains">{page}</DashboardLayout>
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { req, res } = ctx
	if (IS_CLOUD) {
		return {
			redirect: {
				permanent: true,
				destination: "/dashboard/projects",
			},
		}
	}
	const { user, session } = await validateRequest(req)
	if (!user) {
		return {
			redirect: {
				permanent: true,
				destination: "/",
			},
		}
	}
	if (user.role === "member") {
		return {
			redirect: {
				permanent: true,
				destination: "/dashboard/settings/profile",
			},
		}
	}

	const helpers = createServerSideHelpers({
		router: appRouter,
		ctx: {
			req: req as never,
			res: res as never,
			db: null as never,
			session: session as never,
			user: user as never,
		},
		transformer: superjson,
	})
	await helpers.user.get.prefetch()
	await helpers.settings.isCloud.prefetch()

	return {
		props: {
			trpcState: helpers.dehydrate(),
		},
	}
}
