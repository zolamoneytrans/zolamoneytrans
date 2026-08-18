const ftp = require("basic-ftp");
const path = require("path");

async function deploy() {
    const client = new ftp.Client();
    client.ftp.verbose = true;
    try {
        await client.access({
            host: "ftp.zolamoneytrans.com",
            user: "ftp@zolamoneytrans.com",
            password: "christanne1A",
            secure: false
        });
        console.log("Connected to FTP server");
        
        // Let's check what's in the current directory on FTP
        const list = await client.list();
        console.log("FTP Root Directory contains:", list.map(f => f.name));
        
        // We probably want to upload to root if it's the main domain
        // Many hosts use /public_html or /htdocs or similar, let's see.
        let targetDir = "/";
        if (list.some(f => f.name === "public_html")) targetDir = "/public_html";
        else if (list.some(f => f.name === "htdocs")) targetDir = "/htdocs";
        else if (list.some(f => f.name === "www")) targetDir = "/www";
        
        console.log("Uploading to:", targetDir);
        await client.uploadFromDir(path.join(__dirname, "www"), targetDir);
        console.log("Upload completed successfully!");
    }
    catch(err) {
        console.error("FTP Deployment Error:", err);
    }
    finally {
        client.close();
    }
}

deploy();
