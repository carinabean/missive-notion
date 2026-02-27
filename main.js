let settings = {
    apiKey: '',
    databaseIds: []
};

let currentEmails = [];
let currentConversationId = null;

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
    });
    
    // Initial fetch if a conversation is already open when the iframe loads
    Missive.fetchConversations().then(conversations => {
        if (conversations && conversations.length > 0 && settings.apiKey) {
            handleConversationChange([conversations[0].id]);
        }
    }).catch(e => {
        // Silently catch error if fetchConversations fails without IDs
    });
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
        currentConversationId = null;
        return;
    }

    currentConversationId = ids[0];
    setStatus('Loading emails from conversation...');
    clearResults();
    
    try {
        // Need to pass array to fetchConversations
        const conversations = await Missive.fetchConversations(ids);
        
        if (!conversations || conversations.length === 0) {
            setStatus('Could not load conversation data.');
            return;
        }

        // Use Missive's built-in helper to extract all emails from the conversations
        const emailFields = Missive.getEmailAddresses(conversations);
        if (emailFields && emailFields.length > 0) {
            // Filter out our own domain
            const filteredEmails = emailFields.filter(field => !field.address.toLowerCase().includes('recruitomics.com'));
            
            // Map to objects holding both name and address
            const uniqueContacts = [];
            const seenAddresses = new Set();
            
            filteredEmails.forEach(field => {
                if (!seenAddresses.has(field.address)) {
                    seenAddresses.add(field.address);
                    uniqueContacts.push({
                        address: field.address,
                        name: field.name || ''
                    });
                }
            });
            
            currentEmails = uniqueContacts;
        } else {
            currentEmails = [];
        }
        
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
        setStatus('Error loading conversation context. Check Developer Tools.');
    }
}

function renderEmails(contacts) {
    const container = document.getElementById('emails-container');
    container.innerHTML = '';
    
    contacts.forEach(contact => {
        const pill = document.createElement('div');
        pill.className = 'email-pill';
        pill.innerText = contact.name ? `${contact.name} <${contact.address}>` : contact.address;
        pill.onclick = () => searchNotion(contact);
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

async function searchNotion(contact) {
    const searchTerm = contact.name || contact.address;
    setStatus(`Searching Notion for: ${searchTerm}...`);
    clearResults();
    
    const resultsContainer = document.getElementById('results');
    
    // Highlight active pill
    document.querySelectorAll('.email-pill').forEach(pill => {
        if (pill.innerText.includes(contact.address)) {
            pill.style.background = 'var(--missive-blue, #0366d6)';
            pill.style.color = 'white';
        } else {
            pill.style.background = 'var(--missive-background-color-active, #f1f8ff)';
            pill.style.color = 'var(--missive-blue, #0366d6)';
        }
    });
    
    try {
        const proxyUrl = 'https://corsproxy.io/?'; 
        let allResults = [];
        
        // Search each configured database directly
        for (let i = 0; i < settings.databaseIds.length; i++) {
            const dbId = settings.databaseIds[i].replace(/-/g, '');
            const targetUrl = `https://api.notion.com/v1/databases/${dbId}/query`;
            
            // Build a query that looks for either the email address in an Email property, OR the name in a Title property
            let orConditions = [
                {
                    property: "Email",
                    email: {
                        equals: contact.address
                    }
                }
            ];
            
            if (contact.name) {
                // Assuming the primary column is usually named "Name" or "Candidate Name"
                // For a robust generic query we might have to just rely on the API. 
                // Let's search the global text for the name as well to catch variations in column names.
            }

            const response = await fetch(proxyUrl + encodeURIComponent(targetUrl), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${settings.apiKey}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': 'application/json',
                    'x-requested-with': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    filter: {
                        or: [
                            {
                                property: "Email", // Assumption: Your email column is named exactly "Email"
                                email: {
                                    equals: contact.address
                                }
                            }
                        ]
                    }
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.results) {
                    allResults = allResults.concat(data.results);
                }
            } else {
                // If it fails (maybe the column isn't named "Email"), fallback to global search for the Name/Email string
                console.warn(`Direct DB query failed for ${dbId}, falling back to global search`);
            }
        }
        
        // Fallback: If DB query found nothing, do a global search for the name/email
        if (allResults.length === 0) {
            const globalTargetUrl = 'https://api.notion.com/v1/search';
            const globalResponse = await fetch(proxyUrl + encodeURIComponent(globalTargetUrl), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${settings.apiKey}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': 'application/json',
                    'x-requested-with': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    query: contact.name || contact.address,
                    filter: { value: 'page', property: 'object' },
                    page_size: 20
                })
            });

            if (globalResponse.ok) {
                const data = await globalResponse.json();
                if (data.results) {
                    // Filter down to just our databases
                    allResults = data.results.filter(page => {
                        if (page.parent && page.parent.type === 'database_id') {
                            const pageDbId = page.parent.database_id.replace(/-/g, '');
                            return settings.databaseIds.some(configuredId => configuredId.replace(/-/g, '') === pageDbId);
                        }
                        return false;
                    });
                }
            }
        }
        
        if (allResults.length === 0) {
            setStatus(`No matches found for ${contact.name || contact.address} in your configured databases.`);
            return;
        }
        
        setStatus(`Found ${allResults.length} matches.`);
        
        // Remove duplicates if the global search and db search both ran
        const uniqueResults = [];
        const seenIds = new Set();
        allResults.forEach(page => {
            if (!seenIds.has(page.id)) {
                seenIds.add(page.id);
                uniqueResults.push(page);
            }
        });

        uniqueResults.forEach(page => {
            let title = 'Untitled';
            if (page.properties) {
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
            
            const card = document.createElement('div');
            card.className = 'page-link'; // reusing the class for styling
            card.style.cursor = 'default';
            
            card.innerHTML = `
                <div class="title">${title}</div>
                <div style="display: flex; gap: 8px; margin-top: 8px;">
                    <button class="btn-action" onclick="openNotionPage('${webUrl}')" style="background: var(--missive-blue); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">Open in Notion</button>
                    <button class="btn-action" id="save-btn-${page.id}" onclick="saveEmailToNotion('${page.id}')" style="background: #e1e4e8; color: #24292e; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">Save Email to Page</button>
                </div>
            `;
            
            resultsContainer.appendChild(card);
        });

    } catch (error) {
        console.error('Notion Search Error:', error);
        setStatus(`Error searching Notion: ${error.message}`);
    }
}

function openNotionPage(url) {
    Missive.openURL(url);
}

async function saveEmailToNotion(pageId) {
    const btn = document.getElementById(`save-btn-${pageId}`);
    btn.innerText = 'Saving...';
    btn.disabled = true;

    try {
        if (!currentConversationId) throw new Error("No active conversation.");
        
        const conversations = await Missive.fetchConversations([currentConversationId]);
        if (!conversations || conversations.length === 0) throw new Error("Could not load conversation.");
        const conversation = conversations[0];
        const latestMessage = conversation.latest_message;
        
        if (!latestMessage) throw new Error("No messages found in this conversation.");

        let emailBodyText = latestMessage.preview || "No preview available";
        const subject = latestMessage.subject || conversation.subject || "No Subject";
        const fromAddress = latestMessage.from_field ? latestMessage.from_field.address : "Unknown Sender";
        const dateStr = new Date(latestMessage.delivered_at * 1000).toLocaleString();

        const proxyUrl = 'https://corsproxy.io/?'; 
        const targetUrl = `https://api.notion.com/v1/blocks/${pageId}/children`;

        const requestBody = {
            children: [
                {
                    object: 'block',
                    type: 'heading_3',
                    heading_3: {
                        rich_text: [{ type: 'text', text: { content: 'Email Logged: ' + subject } }]
                    }
                },
                {
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                        rich_text: [{ type: 'text', text: { content: `From: ${fromAddress} on ${dateStr}` } }]
                    }
                },
                {
                    object: 'block',
                    type: 'quote',
                    quote: {
                        rich_text: [{ type: 'text', text: { content: emailBodyText.substring(0, 1990) } }]
                    }
                }
            ]
        };

        const response = await fetch(proxyUrl + encodeURIComponent(targetUrl), {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
                'x-requested-with': 'XMLHttpRequest'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || `API Error: ${response.status}`);
        }

        btn.innerText = 'Saved!';
        btn.style.background = '#28a745';
        btn.style.color = 'white';
        
        setTimeout(() => {
            btn.innerText = 'Save Email to Page';
            btn.style.background = '#e1e4e8';
            btn.style.color = '#24292e';
            btn.disabled = false;
        }, 3000);

    } catch (err) {
        console.error("Save to Notion Error:", err);
        btn.innerText = 'Error';
        btn.style.background = '#cb2431';
        btn.style.color = 'white';
        alert("Failed to save email: " + err.message);
        
        setTimeout(() => {
            btn.innerText = 'Save Email to Page';
            btn.style.background = '#e1e4e8';
            btn.style.color = '#24292e';
            btn.disabled = false;
        }, 3000);
    }
}