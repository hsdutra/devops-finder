const themeToggle = document.querySelector('#theme-toggle');
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let theme = localStorage.getItem('theme');

function updateTheme() {
  const dark = theme === 'dark' || (theme !== 'light' && systemTheme.matches);
  const action = dark ? 'Switch to light theme' : 'Switch to dark theme';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeToggle.querySelector('.sun').style.display = dark ? '' : 'none';
  themeToggle.querySelector('.moon').style.display = dark ? 'none' : '';
  themeToggle.setAttribute('aria-label', action);
  themeToggle.title = action;
}

themeToggle.addEventListener('click', () => {
  theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', theme);
  updateTheme();
});
systemTheme.addEventListener('change', updateTheme);
updateTheme();

const search = document.querySelector('#search');
const collection = document.querySelector('#collection');
const project = document.querySelector('#project');
const repository = document.querySelector('#repository');
const advanced = document.querySelector('#advanced');
const filters = document.querySelector('#filters');
const results = document.querySelector('#results');
const status = document.querySelector('#status');
const session = document.querySelector('#session');
document.querySelector('#version').textContent = 'v' + chrome.runtime.getManifest().version;
const errorBox = document.querySelector('#error');
const defaultServer = 'https://dev.azure.com';
const savedConnection = JSON.parse(localStorage.getItem('devops-connections') || 'null');
const server = savedConnection ? savedConnection.active : localStorage.getItem('devops-server') || defaultServer;
let servers = savedConnection?.urls || (server && server !== defaultServer ? [server] : []);
const connectedServer = document.querySelector('#connected-server');
const settings = document.querySelector('#settings-dialog');
const serverInput = document.querySelector('#server-url');
const settingsError = document.querySelector('#settings-error');
const savedServers = document.querySelector('#saved-servers');
const connectionsGrid = document.querySelector('#connections-grid');
const connectionsLabel = document.querySelector('#connections-label');
const settingsActions = document.querySelector('#settings-actions');
const newServer = document.querySelector('#new-server');

const settingsButton = document.querySelector('#settings');
const addServer = document.querySelector('#add-server');
let draftServers = [];
let selectedServer = null;
let editingServer = null;

function renderConnections() {
  savedServers.replaceChildren();
  if (!draftServers.length) {
    const cell = savedServers.insertRow().insertCell();
    cell.colSpan = 3;
    cell.textContent = 'No saved server URLs';
    return;
  }
  for (const url of draftServers) {
    const row = savedServers.insertRow();
    const active = url === selectedServer;
    const activeButton = document.createElement('button');
    activeButton.type = 'button';
    activeButton.className = 'active-connection';
    activeButton.setAttribute('aria-pressed', String(active));
    activeButton.setAttribute('aria-label', (active ? 'Active server URL: ' : 'Set active server URL: ') + url);
    activeButton.title = active ? 'Active server URL' : 'Set as active server URL';
    activeButton.append(materialSymbol(active ? 'check_box' : 'check_box_outline_blank'));
    activeButton.addEventListener('click', () => {
      if (active || !url) return;
      selectedServer = url;
      saveConnections(url, draftServers);
    });
    row.insertCell().append(activeButton);
    row.insertCell().textContent = url;

    const actions = document.createElement('div');
    actions.className = 'connection-actions';
    actions.append(
      connectionAction('Edit', url, () => setConnectionEditor('edit', url)),
      connectionAction('Remove', url, () => {
        if (!window.confirm('Remove this server URL?\n\n' + url)) return;
        const wasActive = selectedServer === url;
        draftServers = draftServers.filter(address => address !== url);
        if (wasActive) selectedServer = draftServers[0] || null;
        saveConnections(selectedServer, draftServers, wasActive);
        if (!wasActive) renderConnections();
      })
    );
    row.insertCell().append(actions);
  }
}

function materialSymbol(name) {
  const icon = document.createElement('span');
  icon.className = 'material-symbols-rounded';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = name;
  return icon;
}

function saveConnections(active, urls, reloadPage = true) {
  servers = [...new Set(urls)];
  localStorage.setItem('devops-connections', JSON.stringify({ active, urls: servers }));
  if (reloadPage) location.reload();
}

function connectionAction(label, url, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'connection-action';
  button.setAttribute('aria-label', label + ' ' + url);
  button.title = label + ' ' + url;
  button.append(materialSymbol(label === 'Edit' ? 'edit' : 'delete'));
  button.addEventListener('click', action);
  return button;
}

function setConnectionEditor(mode, url = null) {
  editingServer = url;
  newServer.hidden = !mode;
  connectionsGrid.hidden = Boolean(mode);
  settingsActions.hidden = !mode;
  addServer.hidden = Boolean(mode);
  connectionsLabel.textContent = mode === 'add' ? 'Add server URL' : mode === 'edit' ? 'Edit server URL' : 'Saved server URLs';
  serverInput.disabled = !mode;
  serverInput.required = Boolean(mode);
  serverInput.value = url || '';
  settingsError.hidden = true;
  if (mode) serverInput.focus();
}

settingsButton.addEventListener('click', () => {
  draftServers = [...servers];
  selectedServer = draftServers.includes(server) ? server : draftServers[0] || null;
  setConnectionEditor(null);
  renderConnections();
  settings.showModal();
});
addServer.addEventListener('click', () => setConnectionEditor('add'));
document.querySelector('#settings-close').addEventListener('click', () => settings.close());
document.querySelector('#settings-cancel').addEventListener('click', () => {
  setConnectionEditor(null);
  renderConnections();
  addServer.focus();
});
document.querySelector('#settings-form').addEventListener('submit', event => {
  event.preventDefault();
  if (serverInput.disabled) return;
  let active = selectedServer;
  if (!serverInput.disabled) {
    let url;
    try {
      url = new URL(serverInput.value.trim());
    } catch {
      settingsError.textContent = 'Enter a valid Azure DevOps URL.';
      settingsError.hidden = false;
      return;
    }
    const path = url.pathname.replace(/\/+$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        (url.hostname === 'dev.azure.com' && !/^\/[^/]+$/.test(path))) {
      settingsError.textContent = 'Enter a server or organization URL without credentials, a query, or a fragment.';
      settingsError.hidden = false;
      return;
    }
    const address = url.origin + path;
    if (editingServer) {
      draftServers = draftServers.map(item => item === editingServer ? address : item);
      if (active === editingServer) active = address;
    } else {
      draftServers.push(address);
      active ||= address;
    }
  }
  saveConnections(active, draftServers);
});

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const compare = (left, right) => collator.compare(left, right);
let entries = [];
let collections = [];
let projects = [];
let partial = false;
let loaded = false;
let sourceTabId = null;

advanced.addEventListener('click', () => {
  filters.hidden = !filters.hidden;
  advanced.setAttribute('aria-expanded', String(!filters.hidden));
  render();
});
search.addEventListener('input', render);
collection.addEventListener('change', () => {
  updateProjects();
  updateRepositories();
  render();
});
project.addEventListener('change', () => {
  updateRepositories();
  render();
});
repository.addEventListener('change', render);

setOptions(collection, 'All collections', []);
updateProjects();
updateRepositories();
load();

async function load() {
  sourceTabId = null;
  const hasServer = Boolean(server && server !== defaultServer);
  connectedServer.textContent = hasServer
    ? server.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    : 'No server selected';
  connectedServer.title = hasServer ? server : 'No server selected';
  connectedServer.hidden = false;
  setConnectionStatus(hasServer ? 'checking' : 'unconfigured');
  errorBox.hidden = true;
  status.hidden = false;
  status.textContent = 'Loading projects and repositories…';
  try {
    if (!server || server === defaultServer) {
      status.hidden = true;
      const heading = document.createElement('h2');
      heading.textContent = 'Setup required';
      const message = document.createElement('p');
      message.textContent = 'Add an Azure DevOps connection in Settings to start searching.';
      const actions = document.createElement('div');
      actions.className = 'error-actions';
      const configure = document.createElement('button');
      configure.type = 'button';
      configure.textContent = 'Open Settings';
      configure.addEventListener('click', () => settingsButton.click());
      actions.append(configure);
      errorBox.replaceChildren(heading, message, actions);
      errorBox.hidden = false;
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    sourceTabId = tab?.id ?? null;
    if (!tab?.id || !(tab.url === server || tab.url?.startsWith(server + '/'))) {
      throw new Error('Open the configured Azure DevOps site, sign in, then click the DevOps Finder toolbar icon.');
    }
    const result = await chrome.runtime.sendMessage({ type: 'searchdevops:load-inventory', sourceTabId: tab.id, serverUrl: server });
    if (!result?.ok) {
      const requestError = new Error(result?.error || 'Could not retrieve data from Azure DevOps.');
      requestError.requiresHostPermission = result?.requiresHostPermission === true;
      throw requestError;
    }

    const inventory = result.inventory;
    collections = [...inventory.collections].sort((a, b) => compare(a.name, b.name));
    partial = inventory.status === 'partial';
    projects = collections.flatMap(group => [...group.projects]
      .sort((a, b) => compare(a.name, b.name))
      .map(item => ({
        ...item,
        collection: group.name,
        project: item.name,
        projectKey: JSON.stringify([group.name, item.name]),
        repositories: []
      })));
    const projectsByKey = new Map(projects.map(item => [item.projectKey, item]));
    entries = collections.flatMap(group => group.projects.flatMap(item =>
      (item.repositories || []).map(repo => ({
        ...repo,
        collection: group.name,
        project: item.name,
        projectKey: JSON.stringify([group.name, item.name])
      }))
    )).sort((a, b) => compare(a.name, b.name) || compare(a.collection, b.collection) || compare(a.project, b.project));
    for (const entry of entries) projectsByKey.get(entry.projectKey).repositories.push(entry);

    setOptions(collection, 'All collections', collections.map(group => new Option(group.name, group.name)));
    updateProjects();
    updateRepositories();
    setConnectionStatus('connected');
    loaded = true;
    render();
  } catch (error) {
    setConnectionStatus('failed');
    status.hidden = true;
    errorBox.hidden = false;
    const link = document.createElement('a');
    link.href = server;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open Azure DevOps';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = error.requiresHostPermission ? 'Grant site access and retry' : 'Try again';
    if (error.requiresHostPermission) {
      retry.addEventListener('click', () => {
        const originPattern = new URL(server).origin + '/*';
        chrome.permissions.request({ origins: [originPattern] }).then(granted => {
          if (granted) {
            load();
          } else {
            message.textContent = 'Access to this Azure DevOps site was not granted. Allow access in the browser prompt, then try again.';
          }
        }).catch(() => {
          message.textContent = 'Could not request access to this Azure DevOps site. Check the browser extension permissions and try again.';
        });
      });
    } else {
      retry.addEventListener('click', load);
    }
    const heading = document.createElement('h2');
    heading.textContent = 'Session unavailable';
    const message = document.createElement('p');
    message.textContent = error.message;
    const actions = document.createElement('div');
    actions.className = 'error-actions';
    actions.append(link, retry);
    errorBox.replaceChildren(heading, message, actions);
  }
}

function setConnectionStatus(state) {
  const labels = {
    unconfigured: 'Not configured',
    checking: 'Checking…',
    connected: 'Connected',
    failed: 'Failed'
  };
  const label = labels[state] || labels.failed;
  const description = connectedServer.textContent + ': ' + label;
  session.textContent = label;
  session.dataset.state = state;
  session.setAttribute('aria-label', description);
  session.title = description;
}

function setOptions(select, label, options) {
  select.replaceChildren(new Option(label, ''), ...options);
  select.disabled = options.length === 0;
}

function updateProjects() {
  const options = collections
    .filter(group => !collection.value || group.name === collection.value)
    .flatMap(group => group.projects.map(item => new Option(
      collection.value ? item.name : item.name + ' · ' + group.name,
      JSON.stringify([group.name, item.name])
    )))
    .sort((a, b) => compare(a.text, b.text));
  setOptions(project, 'All projects', options);
}

function inScope(entry) {
  return (!collection.value || entry.collection === collection.value)
    && (!project.value || entry.projectKey === project.value);
}

function updateRepositories() {
  const options = entries.flatMap((entry, index) => {
    if (!inScope(entry)) return [];
    const label = project.value ? entry.name : entry.name + ' · ' + entry.project + ' / ' + entry.collection;
    return [new Option(label, String(index))];
  });
  setOptions(repository, 'All repositories', options);
}

function render() {
  if (!loaded) return;
  const query = search.value.trim().toLocaleLowerCase('en');
  const selected = repository.value ? entries[Number(repository.value)] : null;
  const activeRepository = filters.hidden ? null : selected;
  const groups = new Map();
  let projectCount = 0;
  for (const item of projects) {
    if (!filters.hidden && !inScope(item)) continue;
    if (activeRepository && item.projectKey !== activeRepository.projectKey) continue;

    const projectMatches = item.name.toLocaleLowerCase('en').includes(query);
    const matchingRepositories = item.repositories.filter(entry =>
      (!activeRepository || entry === activeRepository) && entry.name.toLocaleLowerCase('en').includes(query)
    );
    if (!matchingRepositories.length && (!projectMatches || activeRepository)) continue;
    const filteringRepositories = Boolean(query || activeRepository);
    const visibleRepositories = filteringRepositories ? matchingRepositories : item.repositories;
    if (!groups.has(item.collection)) groups.set(item.collection, []);
    groups.get(item.collection).push(projectItem(item, visibleRepositories, filteringRepositories));
    projectCount++;
  }
  const count = new Intl.NumberFormat('en').format(projectCount);
  status.textContent = (projectCount ? count + (projectCount === 1 ? ' project' : ' projects') : 'No projects found')
    + (partial ? ' · Partial results' : '');
  const expandCollections = Boolean(query || (!filters.hidden && (collection.value || project.value || activeRepository)));
  results.replaceChildren(...Array.from(groups, ([name, rows]) =>
    collectionItem(name, rows, expandCollections)
  ));
  results.scrollTop = 0;
}

function nameBadge(name) {
  const colors = ['#2176cb', '#6540b5', '#a73576', '#aa4126', '#20704a', '#803676'];
  const words = name.trim().split(/\s+/u);
  const badge = document.createElement('span');
  badge.className = 'name-badge';
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = words.slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase('en');
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  badge.style.backgroundColor = colors[hash % colors.length];
  return badge;
}

function collectionItem(name, rows, expanded) {
  const row = document.createElement('li');
  const disclosure = document.createElement('details');
  disclosure.open = expanded;
  const summary = document.createElement('summary');
  summary.className = 'project-summary';
  const label = document.createElement('span');
  label.textContent = name;
  summary.append(nameBadge(name), label);
  const list = document.createElement('ul');
  list.className = 'collection-projects';
  list.append(...rows);
  disclosure.append(summary, list);
  row.className = 'navigation-row';
  row.append(disclosure, navigationLink(collections.find(group => group.name === name).url, name));
  return row;
}

function projectItem(item, visibleRepositories, expanded) {
  const row = document.createElement('li');
  const disclosure = document.createElement('details');
  disclosure.open = expanded;
  const summary = document.createElement('summary');
  summary.className = 'project-summary';
  const name = document.createElement('span');
  name.textContent = item.name;
  const context = document.createElement('small');
  const count = visibleRepositories.length;
  context.textContent = count + (count === 1 ? ' repository' : ' repositories');
  summary.append(nameBadge(item.name), name, context);
  disclosure.append(summary);

  if (count) {
    const list = document.createElement('ul');
    list.className = 'project-repositories';
    for (const entry of visibleRepositories) list.append(resultItem(entry));
    disclosure.append(list);
  }
  if (!count || item.repositoryQueryStatus === 'failed') {
    const message = document.createElement('p');
    message.className = 'project-message';
    message.textContent = item.repositoryQueryStatus === 'failed'
      ? 'Could not load Git repositories.'
      : item.repositories.length ? 'No repositories match your search.' : 'No repositories available.';
    disclosure.append(message);
  }
  row.className = 'navigation-row';
  row.append(disclosure, navigationLink(item.url, item.name));
  return row;
}

function navigationLink(url, name) {
  const link = document.createElement('a');
  link.className = 'open-icon navigation-link';
  bindSourceTabNavigation(link, url);
  link.setAttribute('aria-label', 'Open ' + name + ' in Azure DevOps');
  link.title = 'Open in Azure DevOps';
  link.append(materialSymbol('open_in_new'));
  return link;
}

function bindSourceTabNavigation(link, url) {
  link.href = url;
  link.rel = 'noopener noreferrer';
  link.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (sourceTabId === null) return;

    let destination;
    try {
      destination = new URL(url);
      if (destination.origin !== new URL(server).origin) {
        console.error('Blocked a link outside the configured Azure DevOps server.');
        return;
      }
    } catch (error) {
      console.error(error);
      return;
    }
    chrome.tabs.update(sourceTabId, { url: destination.href }).catch(console.error);
  });
}

function resultItem(entry) {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.className = 'result';
  bindSourceTabNavigation(link, entry.url);

  const isTfvc = entry.type === 'tfvc';
  const icon = document.createElement('i');
  icon.className = isTfvc ? 'repo-icon bowtie-tfvc-repo' : 'repo-icon bowtie-git';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'result-text';
  const name = document.createElement('strong');
  name.textContent = entry.name;
  const details = document.createElement('small');
  details.textContent = isTfvc ? 'TFVC' : 'Git';
  text.append(name, details);
  const open = document.createElement('span');
  open.className = 'open-icon';
  open.setAttribute('aria-hidden', 'true');
  open.append(materialSymbol('open_in_new'));
  link.append(icon, text, open);
  item.append(link);
  return item;
}
