import { Link } from "react-router-dom";

const linkClass =
   "underline decoration-white/30 underline-offset-2 hover:text-white hover:decoration-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export default function LegalLinks({ className = "" }: { className?: string }) {
   return (
      <nav aria-label="Legal" className={className}>
         <Link to="/privacy" className={linkClass}>
            Privacy Policy
         </Link>
         <Link to="/terms" className={linkClass}>
            Terms of Service
         </Link>
      </nav>
   );
}
