import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetsConfigured} from '../src/family-sheets.mjs';

const sheetId='1u-6FRnn3noeK2-fQRT_FK_arengxQycZKXnJqjDEaxg';
const appsScriptUrl='https://script.google.com/macros/s/AKfycbExampleDeployment/exec';
const secret='a'.repeat(64);

test('keyless Apps Script sync is configured only with valid URL and secret',()=>{
  assert.equal(sheetsConfigured({
    SHARIKA_FAMILY_SHEET_ID:sheetId,
    SHARIKA_FAMILY_APPS_SCRIPT_URL:appsScriptUrl,
    SHARIKA_FAMILY_APPS_SCRIPT_SECRET:secret
  }),true);
  assert.equal(sheetsConfigured({
    SHARIKA_FAMILY_SHEET_ID:sheetId,
    SHARIKA_FAMILY_APPS_SCRIPT_URL:'https://example.com/collect',
    SHARIKA_FAMILY_APPS_SCRIPT_SECRET:secret
  }),false);
  assert.equal(sheetsConfigured({
    SHARIKA_FAMILY_SHEET_ID:sheetId,
    SHARIKA_FAMILY_APPS_SCRIPT_URL:appsScriptUrl,
    SHARIKA_FAMILY_APPS_SCRIPT_SECRET:'short'
  }),false);
});

test('legacy Google service-account authentication remains supported',()=>{
  assert.equal(sheetsConfigured({
    SHARIKA_FAMILY_SHEET_ID:sheetId,
    GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL:'sync@example.iam.gserviceaccount.com',
    GOOGLE_SHEETS_PRIVATE_KEY:'test-nonsecret-placeholder'
  }),true);
  assert.equal(sheetsConfigured({SHARIKA_FAMILY_SHEET_ID:sheetId}),false);
});
