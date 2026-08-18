const ftp = require("basic-ftp");
async function run() {
    const client = new ftp.Client();
    try {
        await client.access({
            host: "zolamoneytrans.com",
            user: "ftp@zolamoneytrans.com",
            password: "christianne1A",
            secure: false
        });
        console.log("Connected. Listing root:");
        const list = await client.list();
        for (const item of list) {
            console.log(item.name);
        }
    } catch(err) {
        console.error(err);
    }
    client.close();
}
run();
