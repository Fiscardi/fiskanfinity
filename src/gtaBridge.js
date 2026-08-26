const http = require("http");

function send(command) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:6721/${command}`,
      { method: "GET" },
      (res) => {
        resolve();
      }
    );

    req.on("error", reject);
    req.end();
  });
}

module.exports = {
  send,
};
