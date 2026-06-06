/** API-only project: no landing page. All product behavior lives under /api/*. */
import { notFound } from "next/navigation";

export default function Home() {
  notFound();
}
