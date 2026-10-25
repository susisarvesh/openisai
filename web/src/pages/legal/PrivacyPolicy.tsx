import { Link } from "react-router-dom";
import LegalDocument, { LegalSection } from "@/pages/legal/LegalDocument";
import { DEVELOPER_CONTACT_EMAIL, GOOGLE_DRIVE_SCOPE, PUBLIC_SITE_ORIGIN } from "@/lib/legal";

export default function PrivacyPolicy() {
   return (
      <LegalDocument title="Privacy Policy">
         <LegalSection id="what-this-is" heading="What Save Songs does">
            <p>
               Save Songs is the website at {PUBLIC_SITE_ORIGIN}.
               You paste a public Spotify playlist or album link, check the song list, and can save
               those songs into a folder in your own Google Drive. After that, the site can play
               those files from your Drive.
            </p>
            <p>
               You do not create a Save Songs account. The main screen does not ask for your name,
               email address, or a password.
            </p>
         </LegalSection>

         <LegalSection id="google-account" heading="Google account information">
            <p>
               Sign-in uses Google Identity Services, loaded from https://accounts.google.com/gsi/client.
               The only OAuth scope the application requests is{" "}
               <span className="break-all text-white">{GOOGLE_DRIVE_SCOPE}</span> (<code>drive.file</code>).
               It does not request <code>openid</code>, <code>email</code>, <code>profile</code>, or any
               other Google scope.
            </p>
            <p>
               The application does not call Google&apos;s user information or People APIs. Its code
               does not receive or store your Google name, email address, or profile photo. Google&apos;s
               own consent screen shows the account you pick. That screen is Google&apos;s. This application
               does not read it.
            </p>
            <p>
               Google&apos;s standard description of <code>drive.file</code> tells you the app can see,
               edit, create, and delete only the specific Drive files you use with it. The code in this
               project creates a folder, marks it with a private app property so this app can find it again,
               uploads audio and a <code>save-songs.json</code> file into it, lists folders and files this
               app created, reads that marker file, updates the marker when a playlist is saved again, and
               checks whether a previously created folder was moved to trash. It does not call Drive&apos;s
               delete, copy, or permissions APIs, and it does not open a Google file picker.
            </p>
         </LegalSection>

         <LegalSection id="oauth" heading="How Google authorization works">
            <p>
               The public OAuth client id is built into the website from the{" "}
               <code>VITE_GOOGLE_CLIENT_ID</code> setting. There is no Google client secret in the website.
               The first time you sign in or export in a browser tab, Google asks you to choose an account
               and consent. Later actions in that same tab can reuse the session Google already granted.
               The token client does not store a refresh token, so a new visit asks you to sign in again.
            </p>
            <p>
               Google returns an access token and an expiry time. The website keeps both in memory for that
               tab. It does not write the token to local storage, IndexedDB, or a cookie, and it does not
               send the token to the Save Songs server. The page also sends the current token to this
               site&apos;s service worker, in memory, so playback can start. The service worker sends that
               token only to Google, and the token is not placed in the audio URL. The token is sent as a
               bearer credential on requests to <span className="break-all">https://www.googleapis.com</span> and{" "}
               <span className="break-all">https://www.googleapis.com/upload/drive</span>. When the token
               expires, or you close the tab, the website no longer has it. Signing in, exporting, or
               pressing play asks Google for a token again.
            </p>
         </LegalSection>

         <LegalSection id="drive-operations" heading="What the app does in Google Drive">
            <p>After you sign in, and when you export, your browser does the following with your token:</p>
            <ul className="list-disc space-y-2 pl-5">
               <li>Lists folders this app created that are not in the trash, including a private app property named <code>saveSongs</code>. <code>drive.file</code> only returns files this app created or that you opened with it, so the rest of your Drive stays hidden.</li>
               <li>Reads <code>save-songs.json</code> inside each playlist folder. That file holds the playlist title, artwork URL, and each song&apos;s title, artist, duration, and Drive file id. Those folders are what another browser sees after you sign in with the same Google account.</li>
               <li>For a folder this app created before that marker existed, writes the same app property and builds <code>save-songs.json</code> from the file names already in the folder.</li>
               <li>Looks up a folder id saved earlier on this device for that Spotify playlist or album, and asks Drive whether that folder still exists and is not in the trash.</li>
               <li>If there is no usable folder, creates a new folder named after the playlist or album and sets the private app properties <code>saveSongs=playlist</code> and the Spotify id.</li>
               <li>Lists the files in that folder. The request asks only for each file&apos;s id and name, and skips trashed files.</li>
               <li>Uploads an audio file for a song that is not already in the folder. The upload creates a new file. It does not replace a file that is already there. A song that fails to upload is skipped.</li>
               <li>Writes or replaces <code>save-songs.json</code> in that folder so the playlist list matches the files that were saved.</li>
               <li>When you press play, asks this site&apos;s service worker to stream that file from Drive. The worker sends the token and the browser&apos;s range header to Google and returns the response as a stream, so playback can start before the whole file has downloaded. The audio is not written into the on-device library database, and that stream is not stored in the audio cache.</li>
            </ul>
            <p>
               The folder id is also stored on this device under a local storage key that starts with{" "}
               <code>rheoson-drive-folder:</code>, followed by the Spotify id, so a later export on this
               browser can find the same folder. Drive file ids are cached in this device&apos;s IndexedDB
               library as part of each song&apos;s <code>filePath</code>, in the form <code>drive:</code> plus
               the file id. That cache is a copy. The folder in your Drive, including <code>save-songs.json</code>,
               is the list another browser reads after you sign in there.
            </p>
         </LegalSection>

         <LegalSection id="where-data-goes" heading="What stays on this device, and what is sent to servers">
            <p>On this device, the main screen stores:</p>
            <ul className="list-disc space-y-2 pl-5">
               <li>The Drive folder id described above.</li>
               <li>
                  A cache of the library in the IndexedDB database <code>rheoson-offline</code>: playlist id,
                  Spotify id, title, artwork URL, and each saved song&apos;s title, artist, duration, artwork
                  URL, and Drive file id. This cache does not store the audio bytes. The list that travels
                  between browsers is <code>save-songs.json</code> in your own Drive folder.
               </li>
               <li>
                  A splash timestamp (<code>rheoson-splash-last</code>) and, on iPhone, whether you dismissed
                  the Add to Home Screen hint (<code>rheoson-ios-install-hint</code>).
               </li>
               <li>
                  The Google access token, only in memory, as described above.
               </li>
            </ul>
            <p>
               The service worker can cache the audio response it receives from the Save Songs API while a
               song is being saved. That cache is named <code>rheoson-audio-v2</code>, holds at most 200
               files, and keeps an entry for up to 90 days, on this device. Playback from Drive uses a
               same-origin address that starts with <code>/drive-media/</code>. The service worker forwards
               that request to Google and does not put it in <code>rheoson-audio-v2</code>. The service worker
               also caches the website&apos;s own files so the page can load again, and it can cache some API
               responses from older parts of the same website.
            </p>
            <p>The Save Songs API is a separate service. For the main screen it receives:</p>
            <ul className="list-disc space-y-2 pl-5">
               <li>
                  The Spotify link you paste, in a check request (<code>/api/search/preview</code>) and,
                  if you export, in a match request (<code>/api/search/resolve</code>). The check reads
                  the public Spotify embed page for titles, artists, durations, and artwork. The export
                  match reads that same public page and then looks the songs up on YouTube Music. The
                  match is limited to 100 songs.
               </li>
               <li>
                  A request for each song&apos;s audio (<code>/api/stream/…/audio</code>), including the
                  track id and the file name the website wants to use. Your browser then uploads those
                  bytes to your Drive. The Google token is not part of this request.
               </li>
               <li>
                  An application token that is the same for every visitor and is embedded in the website
                  build. It tells the API the request came from this site. It is not your Google credential
                  and it does not identify you.
               </li>
            </ul>
            <p>
               The API does not receive your Google access token or the contents of your Drive. The main
               screen does not send the library to a database. Authentication on the API is turned off by
               default, and this screen does not create a user record.
            </p>
            <p>
               While the API prepares audio, its code can write a temporary copy in a cache directory.
               The default directory is the server&apos;s temporary folder, with a default cap of 1024 MB.
               This repository does not define how long the host keeps that folder. It is a working cache,
               not an account.
            </p>
            <p>
               If a check or match fails, the API log can include the Spotify URL and the error text.
               Stream logs can include the track id. A separate in-memory counter records the HTTP method,
               path, status code, and how long the request took. That counter does not store request bodies.
               This repository does not set a retention period for those logs. The host, Vercel, also keeps
               its own platform logs. That retention is not defined in this repository.
            </p>
         </LegalSection>

         <LegalSection id="cookies" heading="Cookies, storage, and tracking">
            <p>
               The Save Songs application code does not set cookies. It uses local storage, IndexedDB, and
               the Cache Storage API as described above. Google&apos;s sign-in script and Google APIs may
               set or read Google cookies when you authorize the app. Those cookies are controlled by Google.
            </p>
            <p>
               The main screen does not load an analytics, advertising, or crash-reporting service. The
               same website build still contains older pages, including search, library, settings, and
               listening stats. They are not linked from the main screen. Opening one can send extra
               requests to the API, such as a search query or a request for listening statistics stored
               by that API. This policy describes the main Save Songs screen. It is not a claim that every
               older page is unused.
            </p>
         </LegalSection>

         <LegalSection id="use" heading="How information is used">
            <p>Information is used to:</p>
            <ul className="list-disc space-y-2 pl-5">
               <li>Show the songs on a Spotify playlist or album before anything is saved.</li>
               <li>Find a matching audio file and put it in a folder in your Google Drive when you ask.</li>
               <li>Show the same saved playlists on any browser where you sign in with that Google account.</li>
               <li>Skip a song that is already in the folder, and continue with the rest if one song fails.</li>
               <li>Protect the API with a shared application token and with rate limits.</li>
            </ul>
            <p>
               The application does not sell personal information. It does not use Google user data to
               show ads or to decide creditworthiness.
            </p>
         </LegalSection>

         <LegalSection id="sharing" heading="Who else receives information">
            <p>These services are involved when you use the main screen:</p>
            <ul className="list-disc space-y-2 pl-5">
               <li>Google, for the consent screen, the access token, and Drive file operations. Drive requests go from your browser to Google.</li>
               <li>Spotify, because the API reads the public embed page for the link you pasted. You do not sign in to Spotify.</li>
               <li>YouTube Music, because the API matches song titles and fetches audio from there. The file saved to Drive is that audio, not a Spotify preview.</li>
               <li>Vercel, which hosts the website and the API and keeps platform logs of requests to those hosts.</li>
            </ul>
            <p>
               Artwork URLs in the song list can point at Spotify or YouTube image hosts. Your browser
               loads those images directly.
            </p>
         </LegalSection>

         <LegalSection id="google-limited-use" heading="Google API Services User Data Policy">
            <p>
               Information received from Google APIs is the access token, the ids, names, and private app
               properties of folders this app created, the contents of each folder&apos;s <code>save-songs.json</code>,
               the trashed flag for a folder, and the bytes of those audio files when you play them.
            </p>
            <p>
               Save Songs uses that information only to provide the Drive folder, upload, skip, and playback
               features that are visible in the interface. It transfers that information to Google, because
               that is how the Drive request is made. It does not transfer Google user data to the Save Songs
               API, to an advertising network, or to a data broker. The product has no feature that shows one
               person&apos;s Drive files to anyone else, and the server does not receive those files for a
               person to read.
            </p>
            <p>
               These practices are how the application handles Google user data, and they are meant to meet
               the{" "}
               <a
                  className="text-white underline decoration-white/40 underline-offset-2"
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  rel="noopener noreferrer">
                  Google API Services User Data Policy
               </a>
               , including the Limited Use requirements. Publishing this page does not mean Google has
               certified the app.
            </p>
         </LegalSection>

         <LegalSection id="retention" heading="How long information is kept">
            <p>
               The playlist list and the <code>save-songs.json</code> marker stay in your own Drive folder
               until you delete that folder. Any browser signed into that Google account can read those
               folders after you sign in there. The copy of that list in this browser, the folder id, the
               splash timestamp, and the install hint stay on this device until you clear the site&apos;s
               stored data. The application does not expire them on a schedule. The access token lives only
               until it expires or the tab closes. Google sets the expiry. The code treats a token as due
               for replacement about a minute before that time.
            </p>
            <p>
               The audio cache on this device, if the service worker stored an API response, lasts up to
               90 days or until the 200-file limit drops it. The server&apos;s temporary audio cache has
               a size cap in code and no separate retention period in this repository. Log retention is
               not set in this repository.
            </p>
            <p>
               Files uploaded to Drive stay in your Drive until you delete them there. Revoking this
               app&apos;s access does not delete those files.
            </p>
         </LegalSection>

         <LegalSection id="protection" heading="How information is protected">
            <p>
               The live website and API are served over HTTPS. The Google access token stays in the
               browser tab and is sent only to Google. Drive file bytes used for playback are fetched
               by the browser from Google.
            </p>
            <p>
               This policy does not claim encryption of the on-device library beyond what your browser
               and operating system provide, and it does not claim a security certification. The shared
               application token is present in the website that your browser downloads. It is not a
               secret from someone who can load the site.
            </p>
         </LegalSection>

         <LegalSection id="revoke" heading="Revoking Google access">
            <p>
               You can remove Save Songs from the Google account you used at{" "}
               <a
                  className="break-all text-white underline decoration-white/40 underline-offset-2"
                  href="https://myaccount.google.com/permissions"
                  rel="noopener noreferrer">
                  https://myaccount.google.com/permissions
               </a>
               . After you remove it, this site cannot obtain a new token for that account until you
               consent again. Files already in Drive, including <code>save-songs.json</code>, remain there.
               References cached on a device remain until you clear the site data for {PUBLIC_SITE_ORIGIN}.
            </p>
         </LegalSection>

         <LegalSection id="deletion" heading="Deletion requests">
            <p>
               There is no Save Songs account to delete for the main screen, and the server does not keep
               a copy of your Google profile or Drive files. To remove the shared playlist list and the
               audio, delete that folder in Google Drive. To remove the copy cached in a browser, clear
               this site&apos;s data there.
            </p>
            <p>
               If you still want to ask a question or request deletion of something you believe the
               developer holds, write to{" "}
               <a className="break-all text-white underline decoration-white/40 underline-offset-2" href={`mailto:${DEVELOPER_CONTACT_EMAIL}`}>
                  {DEVELOPER_CONTACT_EMAIL}
               </a>
               .
            </p>
         </LegalSection>

         <LegalSection id="changes" heading="Changes">
            <p>
               If this policy changes, the date at the top of this page will change. The current page is
               at{" "}
               <Link className="text-white underline decoration-white/40 underline-offset-2" to="/privacy">
                  {PUBLIC_SITE_ORIGIN}/privacy
               </Link>
               .
            </p>
         </LegalSection>
      </LegalDocument>
   );
}
