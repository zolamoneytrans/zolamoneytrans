const ftp = require("basic-ftp");

async function deployToFTP() {
    const client = new ftp.Client();
    client.ftp.verbose = true;
    try {
        await client.access({
            host: "ftp.zolamoneytrans.com",
            user: "ftp@zolamoneytrans.com",
            password: "christanne1A",
            secure: false
        });
        
        console.log("Connected to FTP. Uploading files...");
        
        const list = await client.list();
        let targetDir = "";
        if (list.some(f => f.name === 'public_html')) {
            targetDir = "public_html/";
        } else if (list.some(f => f.name === 'www')) {
            targetDir = "www/";
        }

        console.log("Target Dir:", targetDir || "Root");

        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\serdipay_proxy.php", targetDir + "serdipay_proxy.php");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\nopage.html", targetDir + "nopage.html");
        
        // Ensure js dir
        try {
            await client.ensureDir(targetDir + "js");
            // Since ensureDir changes the working directory, let's reset to root or targetDir
            await client.cd("/");
        } catch(e) { console.log(e); }
        
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\js\\admin.js", targetDir + "js/admin.js");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\js\\bendabus_admin.js", targetDir + "js/bendabus_admin.js");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\bendabus_integration_guide.html", targetDir + "bendabus_integration_guide.html");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\js\\zola_api_admin.js", targetDir + "js/zola_api_admin.js");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\zola_api_integration_guide.html", targetDir + "zola_api_integration_guide.html");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\smart_pay.html", targetDir + "smart_pay.html");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\cb_checkout.html", targetDir + "cb_checkout.html");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\auth.html", targetDir + "auth.html");
        await client.uploadFrom("c:\\Users\\jgmsw\\Downloads\\Fintech\\www\\sw.js", targetDir + "sw.js");
        
        console.log("All files uploaded successfully!");
    }
    catch(err) {
        console.error("FTP Error:", err);
    }
    client.close();
}

deployToFTP();
