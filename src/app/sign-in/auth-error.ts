// Never render arbitrary error text from the URL or from an OAuth provider.
export function signInErrorMessage(error: string | undefined) {
  switch (error) {
    case undefined:
      return undefined;
    case "CredentialsSignin":
      return "That handle or passphrase didn’t work. Try again.";
    case "AccessDenied":
    case "OAuthCallbackError":
      return "Google sign-in was cancelled or couldn’t be completed. Please try again.";
    case "OAuthSignInError":
      return "Google sign-in couldn’t start. Please try again.";
    case "Configuration":
      return "Sign-in isn’t set up yet. Check the project’s Google sign-in guide.";
    default:
      return "Sign-in couldn’t be completed. Please try again.";
  }
}
