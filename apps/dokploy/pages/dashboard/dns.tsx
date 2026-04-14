import type { GetServerSidePropsContext } from "next"
import type { ReactElement } from "react"
import { DashboardLayout } from "@/components/layouts/dashboard-layout"

const Page = () => {
	return (
		<div className="flex flex-col gap-4 w-full">
			{/* DNS is managed per-domain under Domains */}
		</div>
	)
}

export default Page

Page.getLayout = (page: ReactElement) => {
	return <DashboardLayout metaName="DNS">{page}</DashboardLayout>
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	return {
		redirect: {
			permanent: true,
			destination: "/dashboard/domains",
		},
	}
}
