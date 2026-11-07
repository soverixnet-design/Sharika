import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../../android-staging/staging-connection.js',import.meta.url),'utf8');
const start=source.indexOf('  function birthdateFromUi(');
const end=source.indexOf('  function manualCountryCode(',start);
assert.ok(start>0&&end>start,'birth-year helpers are included in the Android adapter');
const helpers=runInNewContext(source.slice(start,end)+
  '\n({birthdateFromUi,birthYearOptions,birthMonthOptions,birthDayOptions})');

test('birth year is a separate, accessible dropdown, not an awkward Android native date input',()=>{
  assert.match(source,/name="birth_year" aria-label="Birth year"/);
  assert.match(source,/name="birth_month" aria-label="Birth month"/);
  assert.match(source,/name="birth_day" aria-label="Birth day"/);
  assert.doesNotMatch(source,/name="birthdate" type="date"/);
  assert.match(source,/yearSelect\.addEventListener\('change',refreshDays\)/);
  assert.match(source,/monthSelect\.addEventListener\('change',refreshDays\)/);
  assert.match(helpers.birthYearOptions(),/value="2016"/);
  assert.match(helpers.birthMonthOptions(),/value="9">Sep/);
});

test('day selector follows month length and leap years',()=>{
  assert.match(helpers.birthDayOptions('2000','2'),/value="29"/);
  assert.doesNotMatch(helpers.birthDayOptions('2001','2'),/value="29"/);
  assert.match(helpers.birthDayOptions('2001','1'),/value="31"/);
});

test('valid real birthdates are converted to the API ISO format',()=>{
  assert.equal(helpers.birthdateFromUi('2000','09','28'),'2000-09-28');
  assert.equal(helpers.birthdateFromUi('2000','02','29'),'2000-02-29');
  assert.throws(()=>helpers.birthdateFromUi('2001','02','29'),/valid birth date/);
  assert.throws(()=>helpers.birthdateFromUi('','09','28'),/Select your birth year/);
});

test('under-13 DOB is explained before sending, without bypassing backend policy',()=>{
  assert.throws(()=>helpers.birthdateFromUi('2016','09','28'),/at least 13 years old/);
  const now=new Date(),year=now.getUTCFullYear()-13;
  const mm=String(now.getUTCMonth()+1).padStart(2,'0');
  const dd=String(now.getUTCDate()).padStart(2,'0');
  assert.equal(helpers.birthdateFromUi(String(year),mm,dd),`${year}-${mm}-${dd}`);
  assert.match(source,/message==='invalid_profile'/);
});
