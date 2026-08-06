# Personal Google OAuth

Google OAuth is an optional personal sign-in method for Leash Cloud. It is not an organization identity-provider or SSO configuration surface.

Configure the hosted `client-api` and main website with the approved Google client ID, client secret, and exact callback URLs. Desktop and mobile initiate authentication through the client API and receive only a personal Leash session.

Personal Open Source does not require Google OAuth and uses local bootstrap authentication.

Keep production credentials outside the public repository. Verify callback allowlists, state/PKCE validation, account ownership, logout, and revoked-token behavior before release.
