/* eslint-disable no-undef */
import dotenv from "dotenv";

dotenv.config();

const API_TOKEN = process.env.API_TOKEN;
const APP_ID = process.env.APP_ID;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWsUrl() {
  let delay = 10_000;

  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      console.log(`Requesting Deriv OTP... Attempt ${attempt}/6`);
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

      if (otpResponse.ok) {
        let otpResult;

        try {
          otpResult = JSON.parse(responseText);
        } catch {
          throw new Error(
            `Deriv returned non-JSON response: ${responseText.substring(0, 300)}`
          );
        }

        const wsUrl = otpResult?.data?.url;

        if (!wsUrl) {
          throw new Error(
            `WebSocket URL was not returned by Deriv: ${JSON.stringify(
              otpResult
            )}`
          );
        }

        console.log("✅ WebSocket URL obtained successfully");

        return wsUrl;
      }

      // Cloudflare / rate limit
      if (otpResponse.status === 1015 || otpResponse.status === 429) {
        console.error(
          `⚠️ Deriv rate limited request (${otpResponse.status})`
        );

        console.log(`Waiting ${delay / 1000}s before retrying...`);

        await sleep(delay);

        delay = Math.min(delay * 2, 300_000);

        continue;
      }

      // Other HTTP errors
      throw new Error(
        `Deriv OTP request failed (${otpResponse.status}): ${responseText.substring(
          0,
          500
        )}`
      );
    } catch (error) {
      console.error("❌ OTP request error:", error.message);

      if (attempt === 6) {
        throw error;
      }

      console.log(`Retrying in ${delay / 1000}s...`);

      await sleep(delay);

      delay = Math.min(delay * 2, 300_000);
    }
  }
}

export const wsUrl = await getWsUrl();