import { useRouter } from "next/router";
import { useEffect } from "react";
import type { GetServerSidePropsContext } from "next";

const Page = () => {
	const router = useRouter();
	useEffect(() => {
		void router.replace("/dashboard/settings/dns");
	}, [router]);

	return null;
};

export default Page;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	return {
		redirect: {
			permanent: false,
			destination: "/dashboard/settings/dns",
		},
	};
}
