import { IS_CLOUD, validateRequest } from "@dokploy/server"
import { createServerSideHelpers } from "@trpc/react-query/server"
import type { GetServerSidePropsContext } from "next"
import type { ReactElement } from "react"
import superjson from "superjson"
import { MailDomainPage } from "@/components/dashboard/emails/mail-domain-page"
import { DashboardLayout } from "@/components/layouts/dashboard-layout"
import { appRouter } from "@/server/api/root"

type PageProps = {
	domainId: string
}

const Page = ({ domainId }: PageProps) => {
	return (
		<div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
			<MailDomainPage domainId={domainId} />
		</div>
	)
}

export default Page

Page.getLayout = (page: ReactElement) => {
	return <DashboardLayout metaName="Emails">{page}</DashboardLayout>
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

	const domainIdParam = ctx.params?.domainId
	const domainId = typeof domainIdParam === "string" ? domainIdParam : null
	if (!domainId) {
		return { notFound: true }
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
			domainId,
			trpcState: helpers.dehydrate(),
		},
	}
}

