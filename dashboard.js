    (() => {
      const savedConnection = JSON.parse(localStorage.getItem('devops-connections') || 'null');
      const serverUrl = savedConnection ? savedConnection.active : localStorage.getItem('devops-server');
      const sourceTabId = Number(new URLSearchParams(window.location.search).get('sourceTabId'));
      const workspace = document.getElementById('workspace');
      const emptyState = document.getElementById('emptyState');
      const emptyTitle = document.getElementById('emptyTitle');
      const emptyMessage = document.getElementById('emptyMessage');
      const errorBox = document.getElementById('loadError');
      const search = document.getElementById('search');
      const collectionFilter = document.getElementById('collectionFilter');
      const projectFilter = document.getElementById('projectFilter');
      const repositoryFilter = document.getElementById('repositoryFilter');
      const rows = document.getElementById('rows');
      const refreshButton = document.getElementById('refreshData');
      let inventory = null;

      refreshButton.addEventListener('click', loadInventory);
      search.addEventListener('input', renderRows);
      collectionFilter.addEventListener('change', () => {
        projectFilter.value = '';
        repositoryFilter.value = '';
        populateProjects();
        populateRepositories();
        renderRows();
      });
      projectFilter.addEventListener('change', () => {
        repositoryFilter.value = '';
        populateRepositories();
        renderRows();
      });
      repositoryFilter.addEventListener('change', renderRows);
      document.getElementById('clearFilters').addEventListener('click', () => {
        search.value = '';
        collectionFilter.value = '';
        projectFilter.value = '';
        repositoryFilter.value = '';
        populateProjects();
        populateRepositories();
        renderRows();
        search.focus();
      });

      loadInventory();

      async function loadInventory() {
        showError('');
        if (!Number.isInteger(sourceTabId) || sourceTabId <= 0) {
          showError('Open an Azure DevOps tab and select the DevOps Finder icon to load data.');
          return;
        }
        if (typeof serverUrl !== 'string' || !serverUrl.trim()) {
          showError('No Azure DevOps server is selected. Choose a server in DevOps Finder settings first.');
          return;
        }
        refreshButton.disabled = true;
        refreshButton.textContent = 'Refreshing…';
        if (!inventory) {
          emptyState.hidden = false;
          emptyTitle.textContent = 'Loading Azure DevOps data';
          emptyMessage.textContent = 'Loading collections, projects and repositories from the signed-in tab.';
        }
        try {
          if (!globalThis.chrome?.runtime?.sendMessage) {
            throw new Error('Open this dashboard through the DevOps Finder extension.');
          }
          const result = await chrome.runtime.sendMessage({ type: 'searchdevops:load-inventory', sourceTabId, serverUrl });
          if (!result || !result.ok) {
            const requestError = new Error(result && result.error ? result.error : 'The extension returned no inventory data.');
            if (/\b401\b/.test(requestError.message)) requestError.code = 'unauthorized';
            throw requestError;
          }
          inventory = result.inventory;
          validateInventory(inventory);
          document.getElementById('dataSource').textContent = `Data in memory · updated at ${new Date().toLocaleTimeString('en')}`;
          renderHeader();
          renderSummary();
          renderErrors();
          populateCollections();
          populateProjects();
          populateRepositories();
          emptyState.hidden = true;
          workspace.classList.add('visible');
          renderRows();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not retrieve data from Azure DevOps.';
          const visibleMessage = error instanceof TypeError
            ? 'Could not reach DevOps Finder. Close this dashboard and reopen it from the extension icon.'
            : message;
          showError(visibleMessage, Boolean(error && error.code === 'unauthorized'));
          if (!inventory) {
            emptyState.hidden = false;
            emptyTitle.textContent = 'Could not load data';
            emptyMessage.textContent = 'Open a signed-in Azure DevOps tab and select the DevOps Finder icon.';
          }
        } finally {
          refreshButton.disabled = false;
          refreshButton.textContent = 'Refresh';
        }
      }

      function validateInventory(data) {
        if (!data || typeof data !== 'object' || !Array.isArray(data.collections)) {
          throw new Error('The API response does not contain the expected "collections" array.');
        }
        for (const [index, collection] of data.collections.entries()) {
          if (!collection || typeof collection.name !== 'string' || !Array.isArray(collection.projects)) {
            throw new Error(`Collection ${index + 1} has an invalid structure.`);
          }
          if (collection.projects.some(project => !project || typeof project.name !== 'string')) {
            throw new Error(`The following collection contains an invalid project: ${collection.name}.`);
          }
          for (const project of collection.projects) {
            if (project.repositories !== undefined && !Array.isArray(project.repositories)) {
              throw new Error(`The repository list for project ${project.name} is invalid.`);
            }
            if ((project.repositories || []).some(repository => !repository || typeof repository.name !== 'string')) {
              throw new Error(`The following project contains an invalid repository: ${project.name}.`);
            }
          }
        }
        return data;
      }

      function renderHeader() {
        const line = document.getElementById('serverLine');
        line.replaceChildren();
        const server = document.createElement('span');
        server.textContent = inventory.serverUrl || 'No server specified';
        const safeServer = safeUrl(inventory.serverUrl);
        if (safeServer) {
          const link = document.createElement('a');
          link.href = safeServer;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = inventory.serverUrl;
          line.append(link);
        } else {
          line.append(server);
        }
        const separator = document.createElement('span');
        separator.className = 'separator';
        separator.setAttribute('aria-hidden', 'true');
        const discovery = document.createElement('span');
        discovery.textContent = inventory.collectionDiscovery || 'Data loaded at runtime';
        line.append(separator, discovery);
        const status = inventory.status === 'partial' ? 'partial results' : 'complete results';
        document.getElementById('apiInfo').textContent = `API ${inventory.apiVersion || '—'} · ${status}`;
      }

      function renderSummary() {
        const collections = inventory.collections;
        const totalProjects = collections.reduce((sum, collection) => sum + collection.projects.length, 0);
        const totalRepositories = collections.reduce((sum, collection) => sum + collection.projects.reduce((projectSum, project) => projectSum + (project.repositories || []).length, 0), 0);
        const empty = collections.filter(collection => collection.queryStatus !== 'failed' && collection.projects.length === 0).length;
        const repositoryFailures = collections.reduce((sum, collection) => sum + collection.projects.filter(project => project.repositoryQueryStatus === 'failed').length, 0);
        const failures = Array.isArray(inventory.errors) ? inventory.errors.length : collections.filter(collection => collection.queryStatus === 'failed').length + repositoryFailures;
        document.getElementById('collectionCount').textContent = formatNumber(collections.length);
        document.getElementById('projectCount').textContent = formatNumber(totalProjects);
        document.getElementById('repositoryCount').textContent = formatNumber(totalRepositories);
        document.getElementById('emptyCount').textContent = formatNumber(empty);
        document.getElementById('failureCount').textContent = formatNumber(failures);
        const badge = document.getElementById('queryBadge');
        const partial = inventory.status === 'partial' || failures > 0;
        badge.className = `pill ${partial ? 'failed' : 'complete'}`;
        badge.textContent = partial ? 'Partial results' : 'Data up to date';
      }

      function renderErrors() {
        const errors = Array.isArray(inventory.errors) ? inventory.errors : [];
        const panel = document.getElementById('errorsPanel');
        const list = document.getElementById('errorsList');
        list.replaceChildren();
        errors.forEach(error => {
          const item = document.createElement('li');
          const scope = [error.scope, error.collection, error.project].filter(Boolean).join(' · ');
          item.textContent = `${scope ? scope + ': ' : ''}${error.message || 'No error details available.'}`;
          list.append(item);
        });
        panel.hidden = errors.length === 0;
        document.getElementById('errorsTitle').textContent = `Query errors (${errors.length})`;
      }

      function populateCollections() {
        collectionFilter.replaceChildren(new Option('All collections', ''));
        [...inventory.collections].sort((a, b) => compare(a.name, b.name)).forEach(collection => {
          collectionFilter.add(new Option(collection.name, collection.name));
        });
      }

      function populateProjects() {
        projectFilter.replaceChildren(new Option('All projects', ''));
        const selectedCollection = collectionFilter.value;
        const projects = inventory.collections.flatMap(collection =>
          (!selectedCollection || collection.name === selectedCollection)
            ? collection.projects.map(project => ({ collection, project }))
            : []
        ).sort((left, right) => compare(left.project.name, right.project.name) || compare(left.collection.name, right.collection.name));

        projects.forEach(({ collection, project }) => {
          const label = selectedCollection ? project.name : `${project.name} · ${collection.name}`;
          projectFilter.add(new Option(label, JSON.stringify([collection.name, project.name])));
        });
        projectFilter.disabled = projects.length === 0;
      }

      function populateRepositories() {
        repositoryFilter.replaceChildren(new Option('All repositories', ''));
        const selectedCollection = collectionFilter.value;
        const selectedProject = projectFilter.value ? JSON.parse(projectFilter.value) : null;
        const repositories = [];

        inventory.collections.forEach(collection => {
          if (selectedCollection && collection.name !== selectedCollection) return;
          collection.projects.forEach(project => {
            if (selectedProject && (collection.name !== selectedProject[0] || project.name !== selectedProject[1])) return;
            (project.repositories || []).forEach(repository => {
              repositories.push({ collection, project, repository });
            });
          });
        });

        repositories.sort((left, right) => compare(left.repository.name, right.repository.name) || compare(left.project.name, right.project.name) || compare(left.collection.name, right.collection.name));
        repositories.forEach(({ collection, project, repository }) => {
          let label = repository.name;
          if (!selectedProject && selectedCollection) label += ` · ${project.name}`;
          if (!selectedCollection && !selectedProject) label += ` · ${project.name} (${collection.name})`;
          repositoryFilter.add(new Option(label, JSON.stringify([collection.name, project.name, repository.name])));
        });
        repositoryFilter.disabled = repositories.length === 0;
      }

      function renderRows() {
        if (!inventory) return;
        rows.replaceChildren();
        const query = search.value.trim().toLocaleLowerCase('en');
        const selectedCollection = collectionFilter.value;
        const selectedProject = projectFilter.value ? JSON.parse(projectFilter.value) : null;
        const selectedRepository = repositoryFilter.value ? JSON.parse(repositoryFilter.value) : null;
        let projectCount = 0;
        let repositoryCount = 0;
        const visibleCollections = new Set();

        [...inventory.collections].sort((a, b) => compare(a.name, b.name)).forEach(collection => {
          if (selectedCollection && collection.name !== selectedCollection) return;
          const failed = collection.queryStatus === 'failed';
          const empty = !failed && collection.projects.length === 0;
          const collectionMatch = collection.name.toLocaleLowerCase('en').includes(query);

          if (failed || empty) {
            const message = failed ? (collection.error || 'Could not load the collection.') : 'No projects available';
            if (query && !collectionMatch && !message.toLocaleLowerCase('en').includes(query)) return;
            rows.append(collectionStateRow(collection, failed, message));
            visibleCollections.add(collection.name);
            return;
          }

          const projects = [...collection.projects].sort((a, b) => compare(a.name, b.name));
          projects.forEach(project => {
            if (selectedProject && (collection.name !== selectedProject[0] || project.name !== selectedProject[1])) return;
            const projectMatch = !query || collectionMatch || project.name.toLocaleLowerCase('en').includes(query);
            const repositories = [...(project.repositories || [])].sort((a, b) => compare(a.name, b.name));
            const matchingRepositories = repositories.filter(repository => {
              if (selectedRepository && JSON.stringify([collection.name, project.name, repository.name]) !== JSON.stringify(selectedRepository)) return false;
              return projectMatch || repository.name.toLocaleLowerCase('en').includes(query);
            });
            const repositoryErrorMatch = project.repositoryQueryStatus === 'failed' && (project.repositoryError || '').toLocaleLowerCase('en').includes(query);
            if (!projectMatch && matchingRepositories.length === 0 && !repositoryErrorMatch) return;

            visibleCollections.add(collection.name);
            if (projectMatch || repositoryErrorMatch) {
              rows.append(projectRow(collection, project));
              projectCount++;
            }
            matchingRepositories.forEach(repository => {
              rows.append(repositoryRow(collection, project, repository));
              repositoryCount++;
            });
          });
        });

        if (visibleCollections.size === 0) {
          const row = document.createElement('tr');
          const cell = document.createElement('td');
          cell.colSpan = 5;
          cell.className = 'no-results';
          cell.textContent = 'No results match these filters.';
          row.append(cell);
          rows.append(row);
        }
        const projectLabel = projectCount === 1 ? 'project' : 'projects';
        const repositoryLabel = repositoryCount === 1 ? 'repository' : 'repositories';
        const collectionLabel = visibleCollections.size === 1 ? 'visible collection' : 'visible collections';
        document.getElementById('resultCount').textContent = `${formatNumber(projectCount)} ${projectLabel} · ${formatNumber(repositoryCount)} ${repositoryLabel} · ${formatNumber(visibleCollections.size)} ${collectionLabel}`;
      }

      function projectRow(collection, project) {
        const row = document.createElement('tr');
        row.append(textCell(collection.name, 'collection-name'));
        row.append(textCell(project.name, 'project-name'));
        const repositoryCount = (project.repositories || []).length;
        const repositoryLabel = repositoryCount === 1 ? 'repository' : 'repositories';
        const repositoryDetails = project.repositoryQueryStatus === 'failed'
          ? (project.repositoryError || 'Could not list repositories.')
          : `${formatNumber(repositoryCount)} ${repositoryLabel}`;
        row.append(textCell(repositoryDetails, project.repositoryQueryStatus === 'failed' ? 'row-error' : 'row-message'));
        const state = document.createElement('td');
        state.append(pill(project.repositoryQueryStatus === 'failed' ? 'Repository query failed' : 'Project', project.repositoryQueryStatus === 'failed' ? 'failed' : 'project'));
        row.append(state);
        const access = document.createElement('td');
        const link = document.createElement('a');
        link.className = 'project-link';
        const href = safeUrl(project.url);
        link.textContent = href ? 'Open project ↗' : 'URL unavailable';
        if (href) {
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.setAttribute('aria-label', `Open ${project.name} in a new tab`);
        } else {
          link.classList.add('disabled');
          link.setAttribute('aria-disabled', 'true');
        }
        access.append(link);
        row.append(access);
        return row;
      }

      function repositoryRow(collection, project, repository) {
        const row = document.createElement('tr');
        row.append(textCell(collection.name, 'collection-name'));
        row.append(textCell(project.name, 'project-name'));
        row.append(textCell(repository.name, 'project-name'));
        const state = document.createElement('td');
        state.append(pill('Repository', 'project'));
        row.append(state);
        const access = document.createElement('td');
        const link = document.createElement('a');
        link.className = 'project-link';
        const href = safeUrl(repository.url);
        link.textContent = href ? 'Open repository ↗' : 'URL unavailable';
        if (href) {
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.setAttribute('aria-label', `Open ${repository.name} in a new tab`);
        } else {
          link.classList.add('disabled');
          link.setAttribute('aria-disabled', 'true');
        }
        access.append(link);
        row.append(access);
        return row;
      }

      function collectionStateRow(collection, failed, message) {
        const row = document.createElement('tr');
        row.append(textCell(collection.name, 'collection-name'));
        const details = textCell(message, failed ? 'row-error' : 'row-message');
        details.colSpan = 3;
        row.append(details);
        const state = document.createElement('td');
        state.append(pill(failed ? 'Failed' : 'Empty', failed ? 'failed' : 'empty'));
        row.append(state);
        return row;
      }

      function textCell(value, className) {
        const cell = document.createElement('td');
        cell.className = className;
        cell.textContent = value;
        return cell;
      }

      function pill(label, className) {
        const element = document.createElement('span');
        element.className = `pill ${className}`;
        element.textContent = label;
        return element;
      }

      function safeUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
          const url = new URL(value, inventory && inventory.serverUrl ? inventory.serverUrl : undefined);
          return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
        } catch {
          return null;
        }
      }

      function compare(left, right) { return left.localeCompare(right, 'en', { sensitivity: 'base', numeric: true }); }
      function formatNumber(value) { return new Intl.NumberFormat('en').format(value); }
      function showError(message, requestLogin = false) {
        errorBox.replaceChildren();
        if (message) {
          errorBox.append(document.createTextNode(message));
          if (requestLogin) {
            const loginUrl = safeUrl(serverUrl);
            if (loginUrl) {
              const link = document.createElement('a');
              link.href = loginUrl;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              link.textContent = 'Sign in to Azure DevOps';
              errorBox.append(link);
            }
          }
        }
        errorBox.classList.toggle('visible', Boolean(message));
      }
    })();
  