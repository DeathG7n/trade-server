import dotenv from "dotenv";

dotenv.config();

// eslint-disable-next-line no-undef
const API_TOKEN = process.env.API_TOKEN;
// eslint-disable-next-line no-undef
const APP_ID = process.env.APP_ID;
// eslint-disable-next-line no-undef
const ACCOUNT_ID = process.env.ACCOUNT_ID;

if (!API_TOKEN) {
  throw new Error("API_TOKEN is missing");
}

if (!APP_ID) {
  throw new Error("APP_ID is missing");
}

if (!ACCOUNT_ID) {
  throw new Error("ACCOUNT_ID is missing");
}

const url = `https://api.derivws.com/trading/v1/options/accounts/${ACCOUNT_ID}/otp`;

console.log("Requesting Deriv OTP...");
console.log("Account ID:", ACCOUNT_ID);

const otpResponse = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
    "Deriv-App-ID": APP_ID,
    "Content-Type": "application/json",
  },
});

const responseText = await otpResponse.text();

console.log("OTP Status:", otpResponse.status);
console.log("OTP Response:", responseText);

if (!otpResponse.ok) {
  throw new Error(
    `Deriv OTP request failed (${otpResponse.status}): ${responseText}`,
  );
}

let otpResult;

try {
  otpResult = JSON.parse(responseText);
} catch {
  throw new Error(
    `Deriv returned non-JSON response: ${responseText.substring(0, 300)}`,
  );
}

console.log("Parsed OTP Result:", otpResult);

export const wsUrl = otpResult?.data?.url;

if (!wsUrl) {
  throw new Error(
    `WebSocket URL was not returned by Deriv: ${JSON.stringify(otpResult)}`,
  );
}

console.log("WebSocket URL obtained successfully");