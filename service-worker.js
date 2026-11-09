chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
chrome.sidePanel.setOptions({ enabled: false }).catch(console.error);
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.setOptions({ tabId: tab.id, path: 'popup.html', enabled: true })
    .catch(console.error);
  chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
});

const DEVOPS_ORIGIN = 'https://devops.ageas.pt';
const API_VERSION = '5.0';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'searchdevops:load-inventory') return;
  if (!sender.url || !sender.url.startsWith(chrome.runtime.getURL(''))) {
    sendResponse({ ok: false, error: 'Unauthorized request.' });
    return;
  }

  const sourceTabId = Number(message.sourceTabId);
  if (!Number.isInteger(sourceTabId) || sourceTabId <= 0) {
    sendResponse({ ok: false, error: 'No Azure DevOps tab was specified.' });
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId: sourceTabId },
    world: 'MAIN',
    func: loadInventoryFromDevOps,
    args: [message.serverUrl ?? DEVOPS_ORIGIN, API_VERSION]
  }).then(results => {
    sendResponse(results[0]?.result || { ok: false, error: 'The Azure DevOps tab returned no data.' });
  }).catch(error => {
    const detail = error instanceof Error ? error.message : '';
    sendResponse({
      ok: false,
      requiresHostPermission: /cannot access contents|missing host permission|must request permission to access/i.test(detail),
      error: detail
        ? `Could not retrieve data from the active tab. Open DevOps Finder from an Azure DevOps tab. (${detail})`
        : 'Could not retrieve data from the active Azure DevOps tab.'
    });
  });

  return true;
});

async function loadInventoryFromDevOps(serverUrl, apiVersion) {
  const server = new URL(serverUrl);
  const cloud = server.hostname === 'dev.azure.com' || server.hostname.endsWith('.visualstudio.com');
  if (cloud) apiVersion = '7.1';
  if (location.origin !== server.origin) {
    return { ok: false, error: `The source tab must be on ${serverUrl}.` };
  }

  const errors = [];

  async function getList(relativePath, query, baseUrl = serverUrl) {
    const values = [];
    const seenTokens = new Set();
    let continuationToken = null;

    do {
      const path = relativePath.split('/').map(encodeURIComponent).join('/');
      const url = new URL(`${baseUrl}/${path}`);
      const parameters = new URLSearchParams(query);
      if (continuationToken) parameters.set('continuationToken', continuationToken);
      url.search = parameters.toString();

      const response = await fetch(url.href, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: `application/json;api-version=${apiVersion}` }
      });
      if (response.status === 401) throw new Error('Azure DevOps did not accept the session. Sign in on this tab and try again.');
      if (response.status === 403) throw new Error('You do not have permission to access this resource (403).');
      if (!response.ok) throw new Error(`The API returned ${response.status} ${response.statusText}.`);

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('json')) {
        throw new Error('The response is not JSON. Check that you are signed in to Azure DevOps on this tab.');
      }
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.value)) throw new Error('The API response does not contain the expected list.');
      values.push(...payload.value);

      continuationToken = response.headers.get('x-ms-continuationtoken');
      if (continuationToken) {
        if (seenTokens.has(continuationToken)) throw new Error('The API returned a duplicate continuation token.');
        seenTokens.add(continuationToken);
      }
    } while (continuationToken);

    return values;
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await mapper(items[index]);
      }
    }));
    return results;
  }

  try {
    let scopes;
    if (cloud) {
      const name = server.hostname === 'dev.azure.com'
        ? decodeURIComponent(server.pathname.split('/')[1])
        : server.hostname.split('.')[0];
      scopes = [{ name, url: serverUrl }];
    } else {
      try {
        const discovered = await getList('_apis/projectCollections', { '$top': '100', 'api-version': apiVersion });
        const names = new Set(discovered.map(item => item.name).filter(name => typeof name === 'string' && name.trim()));
        scopes = [...names].map(name => ({ name, url: serverUrl + '/' + encodeURIComponent(name) }));
      } catch (error) {
        if (server.pathname === '/') throw error;
        scopes = [{ name: decodeURIComponent(server.pathname.split('/').at(-1)), url: serverUrl }];
      }
    }
    const collections = await mapWithConcurrency(scopes, 4, async ({ name: collectionName, url: collectionUrl }) => {
      try {
        const apiProjects = await getList('_apis/projects', { '$top': '1000', 'api-version': apiVersion }, collectionUrl);
        const projects = apiProjects.map(project => {
          if (typeof project.name !== 'string' || !project.name.trim()) throw new Error('The response contains a project without a name.');
          const projectUrl = `${collectionUrl}/${encodeURIComponent(project.name)}`;
          return { name: project.name, url: projectUrl };
        });

        const tfvcRoots = new Set();
        try {
          const items = await getList('_apis/tfvc/items', {
            scopePath: '$/',
            recursionLevel: 'OneLevel',
            'api-version': apiVersion
          }, collectionUrl);
          for (const item of items) {
            if (item.isFolder && typeof item.path === 'string') {
              tfvcRoots.add(item.path.toLowerCase());
            }
          }
        } catch (error) {
          errors.push({
            scope: 'tfvc',
            collection: collectionName,
            message: error instanceof Error ? error.message : 'Could not load TFVC repositories.'
          });
        }

        const projectsWithRepositories = await mapWithConcurrency(projects, 6, async project => {
          const path = '$/' + project.name;
          const repositories = tfvcRoots.has(path.toLowerCase())
            ? [{ name: path, type: 'tfvc', url: `${project.url}/_versionControl?path=${encodeURIComponent(path)}` }]
            : [];
          try {
            const apiRepositories = await getList('_apis/git/repositories', { 'api-version': apiVersion }, project.url);
            const gitRepositories = apiRepositories.map(repository => {
              if (typeof repository.name !== 'string' || !repository.name.trim()) throw new Error('The response contains a repository without a name.');
              return {
                name: repository.name,
                url: `${project.url}/_git/${encodeURIComponent(repository.name)}`
              };
            });
            return { ...project, repositories: [...repositories, ...gitRepositories], repositoryQueryStatus: 'complete' };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not load repositories.';
            errors.push({ scope: 'repository', collection: collectionName, project: project.name, message });
            return { ...project, repositories, repositoryQueryStatus: 'failed', repositoryError: message };
          }
        });

        return { name: collectionName, url: collectionUrl, queryStatus: 'complete', projects: projectsWithRepositories };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load the collection.';
        errors.push({ scope: 'collection', collection: collectionName, message });
        return { name: collectionName, url: collectionUrl, queryStatus: 'failed', projects: [], error: message };
      }
    });

    if (collections.length && collections.every(collection => collection.queryStatus === 'failed')) {
      return { ok: false, error: collections[0].error };
    }
    return {
      ok: true,
      inventory: {
        serverUrl,
        apiVersion,
        collectionDiscovery: 'Browser session',
        status: errors.length ? 'partial' : 'complete',
        collections,
        errors
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not retrieve data from Azure DevOps.'
    };
  }
}
