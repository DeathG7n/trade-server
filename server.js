import dotenv from "dotenv";
dotenv.config();

// eslint-disable-next-line no-undef
const API_TOKEN = process.env.API_TOKEN;
// eslint-disable-next-line no-undef
const APP_ID = process.env.APP_ID;
// eslint-disable-next-line no-undef
const ACCOUNT_ID = process.env.ACCOUNT_ID;

const otpResponse = await fetch(
  `https://api.derivws.com/trading/v1/options/accounts/${ACCOUNT_ID}/otp`,
  {
    method: "POST",
    headers: {
      Authorization:
        `Bearer ${API_TOKEN}`,
      "Deriv-App-ID": APP_ID, 
      "Content-Type": "application/json",
    },
  },
);

const otpResult = await otpResponse?.json();
export const wsUrl = otpResult?.data?.url; 
