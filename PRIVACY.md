# Privacy Policy

Last updated: November 9, 2026

DevOps Finder helps users search and open projects and code repositories on an Azure DevOps server they select. This policy explains what the extension accesses, how it is used, and where it is stored.

## Information the extension accesses

When a user searches, the extension reads collection, project, and repository information available to that user's signed-in Azure DevOps account. It also uses the selected Azure DevOps server URL and the user's theme preference.

The extension does not ask for or collect Azure DevOps passwords, authentication tokens, or account profile information.

## How information is used

Inventory information is used only to display and filter search results and to open the selected Azure DevOps page. API requests are sent directly from the browser to the selected Azure DevOps server using the browser's existing sign-in session. The extension's developer does not receive the requests or inventory results.

The extension does not include analytics, advertising, or tracking services. It does not sell or share inventory information with the developer or other third parties.

## Storage and retention

- Saved server URLs and the theme preference are stored in the extension's local storage for the current browser profile.
- Inventory results are held in memory while the extension interface is open. They are not saved as a persistent cache and are cleared when the interface is closed or reloaded.
- The extension does not store passwords or authentication tokens.

## Permissions and server access

The extension uses `activeTab` and `scripting` to access the Azure DevOps tab after the user opens DevOps Finder. If access to a selected server is needed, the browser may ask the user to grant access to that server. The extension requests access only for the configured server origin.

The `sidePanel` permission is used to display the extension interface. Azure DevOps applies its own privacy and data-handling practices to requests it receives.

## External links

When a user opens a result, the browser navigates to that Azure DevOps page. The extension also provides an optional link to its GitHub repository. Those sites are governed by their own privacy policies.

## Contact

For privacy questions, contact the project maintainer through [GitHub Issues](https://github.com/hsdutra/devops-finder/issues).