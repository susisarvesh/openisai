import { Link } from "react-router-dom";
import LegalDocument, { LegalSection } from "@/pages/legal/LegalDocument";
import { DEVELOPER_CONTACT_EMAIL, PUBLIC_SITE_ORIGIN } from "@/lib/legal";

export default function TermsOfService() {
   return (
      <LegalDocument title="Terms of Service">
         <p>
            These terms are the rules for using Save Songs, the website at {PUBLIC_SITE_ORIGIN}.
            They are written for a small personal project. They are not legal advice, and they are
            not a promise that a court in any particular place will enforce every sentence.
         </p>

         <LegalSection id="acceptance" heading="Acceptance">
            <p>
               By using the site, you agree to these terms and to the{" "}
               <Link className="text-white underline decoration-white/40 underline-offset-2" to="/privacy">
                  Privacy Policy
               </Link>
               . If you do not agree, do not use the site.
            </p>
         </LegalSection>

         <LegalSection id="service" heading="What the service does">
            <p>
               Save Songs lets you paste a public Spotify playlist or album link, check the song list,
               and save matching audio files into a folder in your own Google Drive. You can then play
               those files from Drive in the browser. The app is labeled Songs on the main screen.
            </p>
            <p>
               A check reads public information from Spotify&apos;s embed page. It does not save anything.
               An export asks the Save Songs server to match songs on YouTube Music and return audio.
               Your browser uploads that audio to your Drive, one file at a time. A song that fails is
               skipped. The site then keeps a reference to the Drive file on your device so it can play
               later. The audio saved to Drive is not a Spotify preview file, and it is not claimed to
               be a lossless copy.
            </p>
            <p>
               You do not need a Save Songs account. Google authorization is requested only when you
               export, and only for the Drive files this app creates. The details are in the Privacy Policy.
            </p>
         </LegalSection>

         <LegalSection id="your-responsibilities" heading="Your responsibilities">
            <p>You are responsible for the way you use the site. You agree that you will:</p>
            <ul className="list-disc space-y-2 pl-5">
               <li>Use your own Google account when you export, or an account you are allowed to use.</li>
               <li>Make sure you have the rights needed to copy, download, store, and play the music you process.</li>
               <li>Keep control of the Google account you connect. The site cannot sign out of Google for you after you close the tab.</li>
               <li>Use a current browser, and understand that files in Drive count against your own Google storage.</li>
            </ul>
         </LegalSection>

         <LegalSection id="google" heading="Google account and Drive">
            <p>
               Exporting requires you to grant Google&apos;s <code>drive.file</code> permission to this
               site&apos;s OAuth client. Google, not Save Songs, operates the consent screen and Drive.
               Your use of Google is also covered by Google&apos;s own terms and policies.
            </p>
            <p>
               The folder and audio files created in Drive are stored in your Google account. Save Songs
               does not become the owner of those files. You can stop future access in your Google Account
               permissions. Files already uploaded remain in Drive until you delete them.
            </p>
            <p>
               Google can change, limit, or refuse the sign-in or the Drive API. When that happens, export
               or playback can fail even if this website is up.
            </p>
         </LegalSection>

         <LegalSection id="content" heading="Your content and intellectual property">
            <p>
               You keep whatever rights you already have in links you submit and in files created in your
               Drive. Pasting a link does not transfer ownership of a song, album, or playlist to the
               operator of this site, and this site does not transfer those rights to you.
            </p>
            <p>
               Song names, artwork, and audio come from third parties, including Spotify and YouTube.
               Those materials stay subject to the rights of their owners. Save Songs does not grant you
               a license to music. You must decide whether saving or playing a particular recording is
               allowed where you are.
            </p>
            <p>
               The Save Songs software, the name used for this project, and the logo shown in the interface
               are not assigned to you by these terms. You receive only the limited permission to use the
               website as it is offered.
            </p>
         </LegalSection>

         <LegalSection id="copyright" heading="Copyright">
            <p>
               Do not use the site to infringe copyright or any other intellectual property right. The
               site has no separate license store and does not check that you own a recording before it
               fetches a match. If you are a rights holder and believe the service is being used to
               infringe your work, write to the contact address below and include enough detail to identify
               the material. This project does not publish a formal registered-agent notice because no
               registered business address is on file in the project.
            </p>
         </LegalSection>

         <LegalSection id="prohibited" heading="Acceptable use">
            <p>You may not:</p>
            <ul className="list-disc space-y-2 pl-5">
               <li>Probe, overload, or disrupt the site or the API, or bypass the application token, rate limits, or other access controls.</li>
               <li>Use the site to distribute malware, or to upload files to Drive that you are not allowed to store there.</li>
               <li>Misrepresent your identity to Google when you connect an account.</li>
               <li>Resell the site, or present it as an official Spotify, YouTube, or Google product.</li>
               <li>Use another person&apos;s Google account without permission.</li>
            </ul>
         </LegalSection>

         <LegalSection id="third-parties" heading="Third-party services">
            <p>
               Playback and export depend on Spotify&apos;s public pages, YouTube Music, Google Drive,
               and the hosting provider. Those services have their own availability, terms, and outages.
               A change in any of them can break a check, an export, or playback. Save Songs does not
               control those services and is not responsible for their content or their decisions about
               your account.
            </p>
         </LegalSection>

         <LegalSection id="availability" heading="Availability, changes, and stopping the service">
            <p>
               The site is provided as a personal project. It may be slow, incomplete, interrupted, or
               discontinued. Features can be added or removed, including the way a playlist is checked
               or saved. There is no support agreement and no promise of a particular uptime.
            </p>
            <p>
               You can stop using the site at any time. You can also revoke Google access and clear this
               site&apos;s data in your browser. The operator can stop offering the site without notice.
            </p>
         </LegalSection>

         <LegalSection id="disclaimers" heading="Disclaimers">
            <p>
               The site is provided as-is and as available. To the extent the law allows a personal
               project to say this, there is no warranty of accuracy, fitness for a particular purpose,
               uninterrupted service, or that a saved file will match the recording you expected.
               Song matches can be wrong. Some songs will fail to save. Audio quality is whatever the
               matching source returns.
            </p>
         </LegalSection>

         <LegalSection id="liability" heading="Limitation of liability">
            <p>
               To the extent the law allows, the person who operates Save Songs is not liable for indirect,
               incidental, special, or consequential damages, or for lost profits, lost data, or lost Drive
               storage, arising from your use of the site. If a liability cannot be excluded, it is limited
               to the amount you paid to use the site. The site is offered at no charge, so that amount is
               zero. Some places do not allow these limits. In those places, the limit applies only as far
               as the law allows. These terms do not name a governing court, because the project does not
               record a business location.
            </p>
         </LegalSection>

         <LegalSection id="contact" heading="Contact">
            <p>
               Questions about these terms can be sent to{" "}
               <a className="break-all text-white underline decoration-white/40 underline-offset-2" href={`mailto:${DEVELOPER_CONTACT_EMAIL}`}>
                  {DEVELOPER_CONTACT_EMAIL}
               </a>
               . No company name or street address is stated here, because the project does not contain one.
            </p>
            <p>
               These terms were last updated on the date at the top of this page. The current page is{" "}
               <Link className="text-white underline decoration-white/40 underline-offset-2" to="/terms">
                  {PUBLIC_SITE_ORIGIN}/terms
               </Link>
               .
            </p>
         </LegalSection>
      </LegalDocument>
   );
}
