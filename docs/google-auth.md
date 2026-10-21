# Set up Google sign-in

Google sign-in needs a Google Cloud project, OAuth client, session secret, and migrated Neon Postgres database. The OAuth client has not yet been configured or tested end to end. The local demo works without Google credentials; it is not a real Google account and stores its data in the configured Neon database.

The fictional demo is available at [mystery-match-ani.vercel.app](https://mystery-match-ani.vercel.app). The application code now supports Neon Postgres, but the latest code and its database environment must be deployed before hosted profiles and chat can use it. Do not assume a deployed preview already has the new configuration.

## Vercel OAuth client

In Google Auth Platform, create a **Web application** OAuth client and add these exact production values:

- Authorized JavaScript origin: `https://mystery-match-ani.vercel.app`
- Authorized redirect URI: `https://mystery-match-ani.vercel.app/api/auth/callback/google`

You can add the local redirect URIs described below to the same client. If the Google app is in Testing, add each intended Google account under **Audience → Test users**.

In the [Mystery Match Vercel environment settings](https://vercel.com/aniiiixds-projects/mystery-match/settings/environment-variables), configure the client ID as `AUTH_GOOGLE_ID`, the client secret as `AUTH_GOOGLE_SECRET`, a strong `AUTH_SECRET`, and the pooled Neon connection string as `DATABASE_URL` for the intended environment. Set `APP_URL` to the public HTTPS origin for referral and QR links. Apply migrations to the same database using its direct `DATABASE_URL_UNPOOLED` and `npm run db:migrate` from a trusted environment. Never commit or share the secrets. Environment changes take effect on a new deployment.

After deploying the configured application, test the complete sign-in and profile flow on the intended HTTPS URL. No real Google account flow has been verified yet. The rest of this guide covers local setup.

## 1. Create a Google OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and sign in to your Google account.
2. Use the project selector at the top to create a project or select an existing project.
3. Open **Google Auth Platform**. If prompted, select **Get started** and complete the app information: name the app **Mystery Match** and provide the requested support and contact email addresses.
4. Under **Audience**, choose **External** for accounts outside a Google Workspace organization. While publishing status is **Testing**, add the Google accounts you want to use under **Test users**. A Workspace-only app can instead use **Internal** if that is your intention.
5. Open **Clients**, choose **Create client**, and select **Web application**.
6. Under **Authorized redirect URIs**, add the exact URL for the address you will use in your browser:

   ```text
   http://127.0.0.1:3002/api/auth/callback/google
   ```

   If you also open the app as `localhost:3002`, add this separate URI too:

   ```text
   http://localhost:3002/api/auth/callback/google
   ```

   Google treats `localhost` and `127.0.0.1`, and different ports, as different addresses. If you run the app on port 3000 instead, add the matching port-3000 callback and use that same host and port in your browser. No extra Google API access is required.
7. Create the client. Keep the displayed **Client ID** and **Client secret** private; you will put them in the local environment file in the next step.

The relevant Google instructions are [setting up the OAuth consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent) and [creating a web-server OAuth client](https://developers.google.com/identity/protocols/oauth2/web-server). Google requires the redirect URI to match exactly. [Auth.js's Google provider guide](https://authjs.dev/getting-started/providers/google) describes the provider configuration used here.

## 2. Add the credentials to this project

In the project root, open the existing `.env.local` file, or create it if it does not exist. Add the following two lines, replacing the placeholders with the values from Google:

```dotenv
AUTH_GOOGLE_ID=your-google-client-id
AUTH_GOOGLE_SECRET=your-google-client-secret
```

The file also needs `AUTH_SECRET` for encrypted sign-in sessions. If it already has one, keep it: changing it signs out existing sessions. If it is missing, generate a random value by running `openssl rand -base64 32` in a terminal, then add it as `AUTH_SECRET=the-generated-value`. Set `DATABASE_URL` to the pooled Neon URL and `DATABASE_URL_UNPOOLED` to the direct URL for the same database, then apply the schema with `npm run db:migrate` before starting the server. See the [local setup guide](../README.md#run-locally).

For this local setup, leave `AUTH_URL` and `NEXTAUTH_URL` unset, including in your shell environment. Remove or comment out those lines if they are in `.env.local`. The app derives the callback from the browser address; setting either to a loopback IP can cause a host mismatch in the current Next.js/Auth.js combination.

`.env.local` is excluded by the project's `.gitignore`. Do not commit it or share its contents. Only the server needs these values; do not prefix them with `NEXT_PUBLIC_`.

## 3. Restart and try it

1. Restart the development server so it loads the new environment values. To use the preview port, run `npm run dev -- --port 3002`.
2. Open [http://127.0.0.1:3002/sign-in](http://127.0.0.1:3002/sign-in) and choose **Continue with Google**.
3. Choose an account you added as a test user and complete Google's consent screen. You should return to the profile flow; returning members can continue to discovery.

If the Google button is disabled, confirm that `AUTH_SECRET`, `DATABASE_URL`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET` are present and restart the server. For `redirect_uri_mismatch`, check the complete browser address and the redirect URI in the Google client, including host and port. If Google says access is blocked while the app is in testing, confirm that the Google account is listed under **Test users**.

The app requests Google's OpenID and basic-profile scopes. It uses the stable Google subject to identify the account and does not put your Google name, email, or picture into the Mystery Match session or public profile. Auth.js checks state, PKCE and nonce during sign-in.

A public launch requires its own HTTPS domain and registered callback, appropriate Google publishing settings, and production infrastructure and security review. A real Google account flow still needs to be tested once credentials have been added.
