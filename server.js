const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const jwt = require("jsonwebtoken");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });


const cors = require('cors');

const PORT = 3000;

app.use(cors({
    origin:"*",
    methods:"GET,POST, PUT, DELETE",
    credentials:true
}))

const AZURE_OCR_ENDPOINT = "https://ocrdemoteam.cognitiveservices.azure.com/vision/v3.2/read/analyze";
const AZURE_OCR_RESULT_ENDPOINT = "https://ocrdemoteam.cognitiveservices.azure.com/vision/v3.2/read/analyzeResults/";
const AZURE_API_KEY = "FmRdKFwduH30Uw3GaD7qiljULobWBFssqajIAvYsl3ns52YYmWdQJQQJ99BCACYeBjFXJ3w3AAAFACOGCA5G";

const fileUpload = "https://demo.kore.ai/ADEO/index.php";

const generateToken = (clientId, clientSecret) => {
  const jwt_payload = {
    sub: "1234567890",
    appId: clientId,
  };

  return jwt.sign(jwt_payload, clientSecret, {
    algorithm: "HS256",
    noTimestamp: true,
  });
};

app.post("/process", upload.single("file"), async (req, res) => 
{
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const fileName = req.body.filename;

    const appClientId = req.body.clientId;

    const appClientSecret = req.body.clientSecret;

    const appId = req.body.appId;

    const generatedToken = generateToken(
      appClientId,
      appClientSecret
    );

    const INGEST_URL = `https://searchassist.kore.ai/searchassistapi/external/stream/${appId}/ingest?contentSource=manual&extractionType=data&index=true`;
    const AUTH_KEY = generatedToken


    console.log("all Data",req.body);

    try 
    {

        console.log("Uploading file to Azure OCR...");
        //Api 1:- for uploading the pdf for OCR
        const uploadResponse = await axios.post(AZURE_OCR_ENDPOINT, req.file.buffer, {
            headers: {
                "Ocp-Apim-Subscription-Key": AZURE_API_KEY,
                "Content-Type": req.file.mimetype
            }
        });

        // getting the operation-location for operation-id from the headers
        const operationUrl = uploadResponse.headers["operation-location"];
        
        if (!operationUrl) return res.status(500).json({ error: "Operation URL not received" });

        // getting the operation id
        const operationId = operationUrl.split("/").pop();


        console.log("Here is operation id - ", operationId);


        // Api 2:- Polling for OCR completion
        console.log("Waiting for OCR processing to complete...");
        let status = "running";
        let ocrResult;

        while (status === "running" || status === "notStarted") 
        {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const response = await axios.get(`${AZURE_OCR_RESULT_ENDPOINT}${operationId}`, {
                headers: { "Ocp-Apim-Subscription-Key": AZURE_API_KEY }
            });

            status = response.data.status;
            ocrResult = response.data;
        }

        // Extracting the text from OCR result
        const extractedText = ocrResult.analyzeResult.readResults
            .flatMap(result => result.lines.map(line => line.text))
            .join("\n");

        console.log("OCR Processing Completed.");


        //Api 3:- Adding the file to server 
        const formData = new FormData();
        formData.append("file", req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });

        const filePathResponse = await axios.post(fileUpload, formData, {
            headers: formData.getHeaders()
        });

        const filePath = filePathResponse.data.replace(/ /g, "%20");

        console.log("File Uploaded to demo server ", filePath);


        // Api 4:- Sending the extracted text to SearchAssist
        console.log("Sending extracted text to SearchAssist...");

        const searchassistResponse = await axios.post(INGEST_URL, {
            documents: [{
                title: fileName,
                content: extractedText,
                url: filePath
            }],
            name: fileName
        }, {
            headers: {
                "auth": AUTH_KEY,
                "Content-Type": "application/json"
            }
        });

        console.log("Searchassist Ingestion Completed.");

        res.json({ message: "OCR and ingestion completed", searchassistResponse: searchassistResponse.data });

    } catch (error) {
        console.error("Error in process:", error.message);
        res.status(500).json({ error: "Process failed", details: error.response?.data || error.message });
    }
});


app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});


module.exports = app;