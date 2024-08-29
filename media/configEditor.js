


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
    members.forEach(member => {
        // Create the div and the email span
        const memberDiv = document.createElement('div');
        memberDiv.style.paddingBottom = '15px';
        const email = document.createElement('span');
        email.innerText = member.name;
        memberDiv.appendChild(email);
        
        if (isOwner) {
            // Add the remove button
            const removeButton = document.createElement('input');
            removeButton.type = 'image';
            removeButton.src = uris.trash;
            removeButton.classList.add('icon');
            removeButton.classList.add('del_button');

            memberDiv.appendChild(removeButton);
        }

        membersDiv.appendChild(memberDiv);
    });

    // Add all the invites
    // Add all the members
    invites.forEach(member => {
        // Create the div and the email span
        const memberDiv = document.createElement('div');
        memberDiv.style.paddingBottom = '15px';
        const email = document.createElement('span');
        email.innerText = member.name;
        memberDiv.appendChild(email);
        
        if (isOwner) {
            // Add the remove button
            const removeButton = document.createElement('input');
            removeButton.type = 'image';
            removeButton.src = uris.trash;
            removeButton.classList.add('icon');
            removeButton.classList.add('del_button');

            memberDiv.appendChild(removeButton);
        }

        // Add the "Pending invite" text
        const pendingInvite = document.createElement('span');
        pendingInvite.innerText = 'Pending invite';
        pendingInvite.style.color = '#0078d4';
        pendingInvite.style.marginLeft = '40px';
        memberDiv.appendChild(pendingInvite);

        membersDiv.appendChild(memberDiv);
    });
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