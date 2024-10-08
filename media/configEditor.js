const vscode = acquireVsCodeApi();


function updateMembers(owner, members, invites, public, publicMembers, isOwner, uris, backup_frequency, backup_amount, backupPath, addon) {
    // Get the members div
    const membersDiv = document.getElementById('members');

    // Clear the members div
    membersDiv.innerHTML = '';

    // First add the owner
    const ownerDiv = document.createElement('div');
    ownerDiv.style.marginBottom = '15px';
    const email = document.createElement('span');
    email.innerText = owner;
    email.style.padding = '5px 0px';
    ownerDiv.appendChild(email);
    
    let crown = document.createElement('img');
    crown.src = uris.crown;
    crown.classList.add('icon');
    ownerDiv.appendChild(crown);

    // Add the owner div to the members div
    membersDiv.appendChild(ownerDiv);

    // Add all the members
    for (let i = 0; i < members.length; i++) {
        // Create the div and the email span
        const memberDiv = document.createElement('div');
        memberDiv.style.marginBottom = '15px';
        const email = document.createElement('span');
        email.innerText = members[i].name;
        email.style.padding = '5px 0px';
        memberDiv.appendChild(email);
        
        if (isOwner) {
            // Add the remove button
            const removeButton = document.createElement('input');
            removeButton.type = 'image';
            removeButton.src = uris.trash;
            removeButton.classList.add('icon');
            removeButton.classList.add('del_button');

            // Bind event listener to the remove button
            removeButton.addEventListener('click', () => {
                vscode.postMessage({
                    type: 'remove_member',
                    index: i
                });
            });

            memberDiv.appendChild(removeButton);
        }

        membersDiv.appendChild(memberDiv);
    }

    // Add all the invites
    for (let i = 0; i < invites.length; i++) {
        // Create the div and the email span
        const memberDiv = document.createElement('div');
        memberDiv.style.marginBottom = '15px';
        const email = document.createElement('span');
        email.innerText = invites[i].name;
        email.style.padding = '5px 0px';
        memberDiv.appendChild(email);
        
        if (isOwner) {
            // Add the remove button
            const removeButton = document.createElement('input');
            removeButton.type = 'image';
            removeButton.src = uris.trash;
            removeButton.classList.add('icon');
            removeButton.classList.add('del_button');

            // Bind event listener to the remove button
            removeButton.addEventListener('click', () => {
                vscode.postMessage({
                    type: 'remove_invite',
                    index: i
                });
            });

            memberDiv.appendChild(removeButton);
        }

        // Add the "Pending invite" text
        const pendingInvite = document.createElement('span');
        pendingInvite.innerText = 'Pending invite';
        pendingInvite.style.color = '#0078d4';
        pendingInvite.style.marginLeft = '40px';
        memberDiv.appendChild(pendingInvite);

        membersDiv.appendChild(memberDiv);
    }

    // Add all the public members
    for (let i = 0; i < publicMembers.length; i++) {
        // Create the div and the email span
        const memberDiv = document.createElement('div');
        memberDiv.style.marginBottom = '15px';
        const email = document.createElement('span');
        email.innerText = publicMembers[i];
        email.style.padding = '5px 0px';
        memberDiv.appendChild(email);

        // Add the "Global" text
        const publicText = document.createElement('span');
        publicText.innerText = 'Global';
        publicText.style.color = '#0078d4';
        publicText.style.marginLeft = '40px';
        memberDiv.appendChild(publicText);

        membersDiv.appendChild(memberDiv);
    }


    // Global sharing
    if (public) {
        globalSharingCheckbox.checked = true;
        globalSharingText.style.visibility = 'visible';
        copyButton.style.visibility = 'visible';
        globalSharingLink.innerText = public.name;
    } else {
        globalSharingCheckbox.checked = false;
        globalSharingText.style.visibility = 'hidden';
        copyButton.style.visibility = 'hidden';
        globalSharingLink.innerText = '';
    }

    // Backups
    backupFrequency.value = backup_frequency.toString();
    backupAmount.value = backup_amount.toString();

    backupPathText.innerText = backupPath;

    // Project type
    projectType.value = addon;


    // Load the rules inputs from the storage
    const state = vscode.getState();
    if (state) {
        ignoredInput.value = state.ignored;
        staticInput.value = state.static;

        if (!state.ignored_saved) {
            modifiedIgnore();
        }
        if (!state.static_saved) {
            modifiedStatic();
        }
    }
}


function loadInputs(ignored, static) {
    // ignored and staticFiles are arrays of lines, we need to join them
    const ignoredText = ignored.join('\n');
    const staticText = static.join('\n');
    ignoredInput.value = ignoredText;
    staticInput.value = staticText;

    // Load inputs in the storage
    vscode.setState({
        ignored: ignoredText,
        static: staticText,
        ignored_saved: true,
        static_saved: true
    });
}





// Add the message event listener
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            updateMembers(message.config.shareConfig.owner, message.config.shareConfig.members, message.config.shareConfig.invites, message.config.shareConfig.public, message.config.shareConfig.publicMembers, message.config.shareConfig.owner === message.email, message.uris, message.config.filesConfig.backupFrequency, message.config.filesConfig.maximumBackups, message.backupPath, message.config.addon);
            return;
        case 'load_inputs':
            loadInputs(message.ignored, message.static);
    }
});


// Add members
const addButton = document.getElementById('add_member');
const addInput = document.getElementById('add_member_input');
const confirmButton = document.getElementById('confirm_add');
const cancelButton = document.getElementById('cancel_add');

const addDiv = document.getElementById('add_member_div');

addButton.addEventListener('click', () => {
    // Remove the addButton and show the input, the confirm and the cancel buttons
    addDiv.removeChild(addButton);
    addInput.style.visibility = 'visible';
    addInput.focus();
    confirmButton.style.visibility = 'visible';
    cancelButton.style.visibility = 'visible';
});

addInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        // Send a message to the extension to add the member
        vscode.postMessage({
            type: 'add_member',
            email: addInput.value
        });

        // Hide the input, the confirm and the cancel buttons and show the addButton
        addInput.style.visibility = 'hidden';
        confirmButton.style.visibility = 'hidden';
        cancelButton.style.visibility = 'hidden';
        addInput.value = '';
        addDiv.prepend(addButton);
    }
    if (event.key === 'Escape') {
        // Hide the input, the confirm and the cancel buttons and show the addButton
        addInput.style.visibility = 'hidden';
        confirmButton.style.visibility = 'hidden';
        cancelButton.style.visibility = 'hidden';
        addInput.value = '';
        addDiv.prepend(addButton);
    }
});

cancelButton.addEventListener('click', () => {
    // Hide the input, the confirm and the cancel buttons and show the addButton
    addInput.style.visibility = 'hidden';
    confirmButton.style.visibility = 'hidden';
    cancelButton.style.visibility = 'hidden';
    addInput.value = '';

    // Insert the addButton at the start of the div
    addDiv.prepend(addButton);
});

confirmButton.addEventListener('click', () => {
    // Send a message to the extension to add the member
    vscode.postMessage({
        type: 'add_member',
        email: addInput.value
    });

    // Hide the input, the confirm and the cancel buttons and show the addButton
    addInput.style.visibility = 'hidden';
    confirmButton.style.visibility = 'hidden';
    cancelButton.style.visibility = 'hidden';
    addInput.value = '';
    addDiv.prepend(addButton);
});


// Global sharing
const globalSharingCheckbox = document.getElementById('global_sharing');
const globalSharingText = document.getElementById('global_sharing_text');
const globalSharingLink = document.getElementById('global_sharing_link');
const copyButton = document.getElementById('copy_button');

globalSharingCheckbox.addEventListener('change', () => {
    vscode.postMessage({
        type: 'global_sharing',
        checked: globalSharingCheckbox.checked
    });
});

copyButton.addEventListener('click', () => {
    vscode.postMessage({
        type: 'copy_link'
    });
});



// Help messages
const gsHelpIcon = document.getElementById('gs_help_icon');
const gsHelpText = document.getElementById('gs_help_text');
const ifHelpIcon = document.getElementById('if_help_icon');
const ifHelpText = document.getElementById('if_help_text');
const sfHelpIcon = document.getElementById('sf_help_icon');
const sfHelpText = document.getElementById('sf_help_text');
const bHelpIcon = document.getElementById('b_help_icon');
const bHelpText = document.getElementById('b_help_text');

gsHelpIcon.addEventListener('mouseenter', () => {
    gsHelpText.style.display = 'inline-flex';
});
gsHelpIcon.addEventListener('mouseleave', () => {
    gsHelpText.style.display = 'none';
});
ifHelpIcon.addEventListener('mouseenter', () => {
    ifHelpText.style.display = 'inline-flex';
});
ifHelpIcon.addEventListener('mouseleave', () => {
    ifHelpText.style.display = 'none';
});
sfHelpIcon.addEventListener('mouseenter', () => {
    sfHelpText.style.display = 'inline-flex';
});
sfHelpIcon.addEventListener('mouseleave', () => {
    sfHelpText.style.display = 'none';
});
bHelpIcon.addEventListener('mouseenter', () => {
    bHelpText.style.display = 'inline-flex';
});
bHelpIcon.addEventListener('mouseleave', () => {
    bHelpText.style.display = 'none';
});



// Text areas
const ignoredInput = document.getElementById('ignored_input');
const staticInput = document.getElementById('static_input');
const ignoredSave = document.getElementById('ignored_save');
const ignoredSaved = document.getElementById('ignored_saved');
const staticSave = document.getElementById('static_save');
const staticSaved = document.getElementById('static_saved');

// Save buttons
function save() {
    vscode.postMessage({
        type: 'save',
        ignore: ignoredInput.value.split('\n'),
        static: staticInput.value.split('\n')
    });
    ignoredSaved.style.visibility = 'visible';
    ignoredSave.style.display = 'none';
    staticSaved.style.visibility = 'visible';
    staticSave.style.display = 'none';

    const state = vscode.getState();
    vscode.setState({
        ignored: state.ignored,
        static: state.static,
        ignored_saved: true,
        static_saved: true
    });
}

function modifiedIgnore() {
    ignoredSaved.style.visibility = 'hidden';
    ignoredSave.style.display = 'initial';
}
function modifiedStatic() {
    staticSaved.style.visibility = 'hidden';
    staticSave.style.display = 'initial';
}

ignoredSave.addEventListener('click', save);
staticSave.addEventListener('click', save);

// Update the storage when the inputs change
ignoredInput.addEventListener('input', () => {
    const state = vscode.getState();
    vscode.setState({
        ignored: ignoredInput.value,
        static: staticInput.value,
        ignored_saved: false,
        static_saved: state.static_saved
    });
    modifiedIgnore();
});
staticInput.addEventListener('input', () => {
    const state = vscode.getState();
    vscode.setState({
        ignored: ignoredInput.value,
        static: staticInput.value,
        ignored_saved: state.ignored_saved,
        static_saved: false
    });
    modifiedStatic();
});


// Backups
const backupFrequency = document.getElementById('backup_frequency');
const backupAmount = document.getElementById('backup_amount');

// Everytime the value changes, send a message to the extension if it is a valid number
backupAmount.addEventListener('input', () => {
    const value = parseInt(backupAmount.value);
    if (value) {
        vscode.postMessage({
            type: 'backup_amount',
            value: value
        });
    }
});
backupFrequency.addEventListener('input', () => {
    const value = parseInt(backupFrequency.value);
    if (value) {
        vscode.postMessage({
            type: 'backup_frequency',
            value: value
        });
    }
});

const backupPathText = document.getElementById('backup_path_text');
const backupPathCopy = document.getElementById('copy_backup_button');
backupPathCopy.addEventListener('click', () => {
    vscode.postMessage({
        type: 'copy_backup_path',
        value: backupPathText.innerText
    });
});


// Project type
const projectType = document.getElementById('project_type');

projectType.addEventListener('change', () => {
    vscode.postMessage({
        type: 'project_type',
        value: projectType.value
    });
});


// Send a message to the extension to send an update, when the page is loaded
vscode.postMessage({
    type: 'on_load'
});