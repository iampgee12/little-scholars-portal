// Shared by the admin Enroll Students pages and the public registration page.

const ENROL_COUNTRIES = ['Nigeria', 'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia',
  'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
  'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia',
  'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Congo (DR)', 'Costa Rica',
  "Côte d'Ivoire", 'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt',
  'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia',
  'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India',
  'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait',
  'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi',
  'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia',
  'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger',
  'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru',
  'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles',
  'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain',
  'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo',
  'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom',
  'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'];

const ENROL_DIAL_CODES = [['Nigeria', '+234'], ['Ghana', '+233'], ['United Kingdom', '+44'], ['United States', '+1'], ['Canada', '+1'],
  ['Benin', '+229'], ['Cameroon', '+237'], ['Togo', '+228'], ['Kenya', '+254'], ['South Africa', '+27'], ['United Arab Emirates', '+971'],
  ['Ireland', '+353'], ['Germany', '+49'], ['France', '+33'], ['China', '+86'], ['India', '+91']];

const ENROL_TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Prof', 'Rev', 'Engr', 'Chief', 'Barrister', 'Alhaji', 'Alhaja'];
const ENROL_RELATIONSHIPS = ['Father', 'Mother', 'Stepfather', 'Stepmother', 'Guardian', 'Grandfather', 'Grandmother', 'Uncle', 'Aunt',
  'Brother', 'Sister', 'Spouse', 'Sponsor', 'Other'];
const ENROL_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const ENROL_GENOTYPES = ['AA', 'AS', 'AC', 'SS', 'SC', 'CC'];

function enrolEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function enrolOptions(list, selected = '', placeholder = 'Select') {
  return `<option value="">${enrolEsc(placeholder)}</option>` + list.map(item => {
    const [value, label] = Array.isArray(item) ? item : [item, item];
    return `<option value="${enrolEsc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${enrolEsc(label)}</option>`;
  }).join('');
}

// "+234 0802 123 4567" ⇄ { code, number }
function enrolSplitPhone(phone) {
  const m = String(phone || '').trim().match(/^(\+\d{1,4})\s*(.*)$/);
  return m ? { code: m[1], number: m[2] } : { code: '+234', number: String(phone || '').trim() };
}

function enrolPhoneField(id, value = '', label = 'Contact Phone') {
  const { code, number } = enrolSplitPhone(value);
  const codes = ENROL_DIAL_CODES.map(([country, dial]) => `<option value="${dial}"${dial === code ? ' selected' : ''}>${enrolEsc(country)}: ${dial}</option>`).join('');
  return `<div class="en-field"><label class="field-label">${enrolEsc(label)}</label>
    <div class="en-phone"><select class="ctrl-select" id="${id}-code">${codes}</select>
    <input class="field-input" id="${id}" type="tel" placeholder="0802 123 4567" value="${enrolEsc(number)}"></div></div>`;
}

function enrolReadPhone(id) {
  const number = document.getElementById(id)?.value.trim() || '';
  return number ? `${document.getElementById(`${id}-code`)?.value || '+234'} ${number}` : '';
}

// UPPER CASE → Title Case → as typed
function enrolToggleCase(id) {
  const input = document.getElementById(id);
  if (!input || !input.value) return;
  const v = input.value;
  input.value = v === v.toUpperCase()
    ? v.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    : v.toUpperCase();
}

function enrolTempEmail(...nameParts) {
  const base = nameParts.map(p => String(p || '').toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean).join('.') || 'user';
  return `${base}.${Math.floor(1000 + Math.random() * 9000)}@temp.uniquegroupofschools.com`;
}
