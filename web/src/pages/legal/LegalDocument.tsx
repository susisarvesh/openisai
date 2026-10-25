import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import LegalLinks from "@/components/layout/LegalLinks";
import { LEGAL_UPDATED } from "@/lib/legal";

export default function LegalDocument({
   title,
   children,
}: {
   title: string;
   children: ReactNode;
}) {
   return (
      <article
         className="mx-auto w-full max-w-3xl px-4 py-8 text-white sm:px-6 sm:py-12"
         style={{ fontFamily: "Inter, system-ui, -apple-system, sans-serif" }}>
         <p className="text-[13px] font-semibold text-[#b3b3b3]">Save Songs</p>
         <h1 className="mt-2 text-[28px] font-bold leading-[1.2] sm:text-[32px]">{title}</h1>
         <p className="mt-2 text-[13px] text-[#b3b3b3]">Last updated {LEGAL_UPDATED}</p>
         <div className="mt-8 space-y-8 text-[15px] leading-[1.6] text-[#d6d6d6]">{children}</div>
         <footer className="mt-12 border-t border-white/10 pt-6">
            <LegalLinks className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-[#b3b3b3]" />
            <Link
               to="/"
               className="mt-4 inline-block text-[13px] text-[#b3b3b3] underline decoration-white/30 underline-offset-2 hover:text-white">
               Back to Songs
            </Link>
         </footer>
      </article>
   );
}

export function LegalSection({
   id,
   heading,
   children,
}: {
   id: string;
   heading: string;
   children: ReactNode;
}) {
   return (
      <section aria-labelledby={id} className="space-y-3">
         <h2 id={id} className="text-[18px] font-bold leading-snug text-white sm:text-[20px]">
            {heading}
         </h2>
         <div className="space-y-3">{children}</div>
      </section>
   );
}
