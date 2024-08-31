const vscode = acquireVsCodeApi();


function updateMembers(owner, members, invites, isOwner, uris) {
    // Get the members div
    const membersDiv = document.getElementById('members');

    // Clear the members div
    membersDiv.innerHTML = '';

    // First add the owner
    const ownerDiv = document.createElement('div');
    ownerDiv.style.paddingBottom = '15px';
    const email = document.createElement('span');
    email.innerText = owner;
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
        memberDiv.style.paddingBottom = '15px';
        const email = document.createElement('span');
        email.innerText = members[i].name;
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
        memberDiv.style.paddingBottom = '15px';
        const email = document.createElement('span');
        email.innerText = invites[i].name;
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
    };
}





// Add the message event listener
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            updateMembers(message.config.owner, message.config.members, message.config.invites, message.config.owner === message.email, message.uris);
            return;
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
    confirmButton.style.visibility = 'visible';
    cancelButton.style.visibility = 'visible';
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


// Send a message to the extension to send an update, when the page is loaded
vscode.postMessage({
    type: 'on_load'
});