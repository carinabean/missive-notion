let settings = {
    apiKey: '',
    databaseIds: []
};

let currentEmails = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Check for settings in Missive's secure store
    await loadSettings();
    
    if (!settings.apiKey || settings.databaseIds.length === 0) {
        showSettings();
    } else {
        showApp();
    }

    document.getElementById('save-settings').addEventListener('click', saveSettings);
    document.getElementById('edit-settings').addEventListener('click', showSettings);

    Missive.on('change:conversations', (ids) => {
        if (settings.apiKey && settings.databaseIds.length > 0) {
            handleConversationChange(ids);
        }
    }, { retroactive: true });
});

async function loadSettings() {
    const apiKey = await Missive.storeGet('notion_api_key');
    const dbsStr = await Missive.storeGet('notion_db_ids');
    
    settings.apiKey = apiKey || '';
    if (dbsStr) {
        settings.databaseIds = dbsStr.split(',').map(id => id.trim()).filter(id => id);
    }
    
    document.getElementById('notion-key').value = settings.apiKey;
    document.getElementById('notion-dbs').value = settings.databaseIds.join(', ');
}

async function saveSettings() {
    const key = document.getElementById('notion-key').value.trim();
    const dbs = document.getElementById('notion-dbs').value.trim();
    
    if (!key) {
        alert('Please enter a Notion API key.');
        return;
    }
    if (!dbs) {
        alert('Please enter at least one Database ID.');
        return;
    }
    
    await Missive.storeSet('notion_api_key', key);
    await Missive.storeSet('notion_db_ids', dbs);
    
    await loadSettings();
    showApp();
    
    // Reload to re-trigger the conversation hook cleanly
    Missive.reload();
}

function showSettings() {
    document.getElementById('app-view').style.display = 'none';
    document.getElementById('settings-view').style.display = 'block';
}

function showApp() {
    document.getElementById('settings-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'block';
}

async function handleConversationChange(ids) {
    if (!ids || ids.length === 0) {
        setStatus('Select an email to view Notion links.');
        clearResults();
        clearEmails();
        return;
    }

    setStatus('Loading emails from conversation...');
    clearResults();
    
    try {
        const conversations = await Missive.fetchConversations(ids);
        
        // Use Missive's built-in helper to extract all emails from the conversations
        const emailFields = Missive.getEmailAddresses(conversations);
        currentEmails = [...new Set(emailFields.map(field => field.address))];
        
        if (currentEmails.length > 0) {
            renderEmails(currentEmails);
            setStatus('Select an email below to search in Notion.');
            
            // Auto-search the first email we find
            searchNotion(currentEmails[0]);
        } else {
            clearEmails();
            setStatus('No email addresses found in this conversation.');
        }
        
    } catch (error) {
        console.error('Error fetching conversation details:', error);
        setStatus('Error loading conversation context.');
    }
}

function renderEmails(emails) {
    const container = document.getElementById('emails-container');
    container.innerHTML = '';
    
    emails.forEach(email => {
        const pill = document.createElement('div');
        pill.className = 'email-pill';
        pill.innerText = email;
        pill.onclick = () => searchNotion(email);
        container.appendChild(pill);
    });
}

function setStatus(text) {
    document.getElementById('status').innerText = text;
}

function clearResults() {
    document.getElementById('results').innerHTML = '';
}

function clearEmails() {
    document.getElementById('emails-container').innerHTML = '';
}

async function searchNotion(email) {
    setStatus(`Searching Notion for: ${email}...`);
    clearResults();
    
    const resultsContainer = document.getElementById('results');
    
    // Highlight active pill
    document.querySelectorAll('.email-pill').forEach(pill => {
        if (pill.innerText === email) {
            pill.style.background = 'var(--missive-blue, #0366d6)';
            pill.style.color = 'white';
        } else {
            pill.style.background = 'var(--missive-background-color-active, #f1f8ff)';
            pill.style.color = 'var(--missive-blue, #0366d6)';
        }
    });
    
    try {
        // We use a CORS proxy because Notion API blocks direct browser calls
        const proxyUrl = 'https://corsproxy.io/?'; 
        const targetUrl = 'https://api.notion.com/v1/search';
        
        const response = await fetch(proxyUrl + encodeURIComponent(targetUrl), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
                'x-requested-with': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                query: email,
                filter: { value: 'page', property: 'object' },
                page_size: 20
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || `API Error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Filter the search results so we only show pages that live inside the databases the user configured
        const filteredResults = data.results.filter(page => {
            if (page.parent && page.parent.type === 'database_id') {
                const pageDbId = page.parent.database_id.replace(/-/g, '');
                return settings.databaseIds.some(configuredId => configuredId.replace(/-/g, '') === pageDbId);
            }
            return false;
        });
        
        if (filteredResults.length === 0) {
            setStatus(`No matches found in Notion for ${email}.`);
            return;
        }
        
        setStatus(`Found ${filteredResults.length} matches for ${email}.`);
        
        filteredResults.forEach(page => {
            let title = 'Untitled';
            if (page.properties) {
                // Find a property of type 'title'
                for (let prop in page.properties) {
                    if (page.properties[prop].type === 'title') {
                        const titleArr = page.properties[prop].title;
                        if (titleArr && titleArr.length > 0) {
                            title = titleArr.map(t => t.plain_text).join('');
                        }
                        break;
                    }
                }
            }
            
            // Build links
            const rawId = page.id.replace(/-/g, '');
            const desktopUrl = `notion://www.notion.so/${rawId}`;
            const webUrl = page.url;
            
            const a = document.createElement('a');
            a.href = desktopUrl;
            a.className = 'page-link';
            
            a.innerHTML = `
                <div class="title">${title}</div>
                <div style="font-size: 11px; color: #586069; margin-top: 4px;">
                    <a href="${webUrl}" target="_blank" style="color: var(--missive-blue); text-decoration: none;" onclick="event.stopPropagation();">Open in Web Browser</a>
                </div>
            `;
            
            resultsContainer.appendChild(a);
        });

    } catch (error) {
        console.error('Notion Search Error:', error);
        setStatus(`Error searching Notion: ${error.message}`);
    }
}