const ftp = require("basic-ftp");

async function deploySingleFile() {
    const client = new ftp.Client();
    client.ftp.verbose = true;
    try {
        await client.access({
            host: "ftp.zolamoneytrans.com",
            user: "ftp@zolamoneytrans.com",
            password: "christanne1A",
            secure: false
        });
        console.log("Connected. Uploading files...");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\js\\admin.js", "/public_html/js/admin.js");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\nopage.html", "/public_html/nopage.html");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\sw.js", "/public_html/sw.js");
        console.log("Upload completed successfully!");
    }
    catch(err) {
        console.error("FTP Error:", err);
    }
    finally {
        client.close();
    }
}
deploySingleFile();
