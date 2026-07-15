import https from 'https';

const clientId = 'c8b6d39a3f9e42be8ce0eb68832a84a7'; // I'll use some random string? No, I need valid credentials. Let's read from localStorage? Wait, node doesn't have localStorage. 
// I'll just write a script that reads from .env or just use the local file config if there's any.
// Actually, since I am in the backend folder, I can just require/import `spotify-api.js` and use it. BUT I don't have the client id and secret.
