/**
 * Response bodies transcribed from Cashfree's published API reference examples (Secure ID v2,
 * vrsv2.yaml). Identifiers are Cashfree's own documentation values. Used by the contract tests.
 */

export const GSTIN_EXISTS = {
  reference_id: 19,
  GSTIN: "29AAICP2912R1ZR",
  legal_name_of_business: "UJJIVAN SMALL FINANCE BANK LIMITED",
  trade_name_of_business: "UJJIVAN SMALL FINANCE BANK",
  center_jurisdiction: "I-A RANGE",
  state_jurisdiction: "GUWAHATI - A - 1",
  date_of_registration: "2017-09-30",
  constitution_of_business: "Public Limited Company",
  taxpayer_type: "Regular",
  gst_in_status: "Active",
  last_update_date: "2022-03-01",
  nature_of_business_activities: ["Retail Business", "Supplier of Services", "Recipient of Goods or Services", "Office / Sale Office", "Others"],
  principal_place_address: "First Floor 3512-DISPUR Prithivi Mansion opp. KFC building G.S. Road, Lachit Nagar Assam 781007",
  principal_place_split_address: {
    building_name: "Prithivi Mansion",
    street: "G.S. Road",
    location: "Lachit Nagar",
    building_number: "3512-DISPUR",
    district: "Guwahati",
    state: "Assam",
    city: "Dispur",
    flat_number: "First Floor",
    latitude: "26.1445",
    longitude: "91.7362",
    pincode: "781007",
  },
  additional_address_array: [],
  valid: true,
  message: "GSTIN Exists",
};

export const GSTIN_NOT_FOUND = { reference_id: 20, GSTIN: "22ABCDE1234F1Z5", message: "GSTIN Doesn't Exist" };

export const PAN_VALID = {
  pan: "ABCPV1234D",
  type: "Individual",
  reference_id: 161,
  name_provided: "JOHN DOE",
  registered_name: "JOHN DOE",
  valid: true,
  message: "PAN verified successfully",
  name_match_score: 100,
  name_match_result: "DIRECT_MATCH",
  aadhaar_seeding_status: "Y",
  last_updated_at: "01/01/2019",
  name_pan_card: "JOHN DOE",
  pan_status: "VALID",
  pan_status_code: "E",
  pan_status_desc: "Existing and Valid",
  aadhaar_seeding_status_desc: "Aadhaar is linked to PAN",
};

export const PAN_PARTIAL_COMPANY = {
  pan: "AAOCS4553K",
  type: "Company",
  reference_id: 1318808,
  name_provided: "saanchi",
  registered_name: "SAANCHI ENERGY PRIVATE LIMITED",
  valid: true,
  message: "PAN verified successfully",
  name_match_score: "60.00",
  name_match_result: "MODERATE_PARTIAL_MATCH",
  aadhaar_seeding_status: "NA",
  last_updated_at: "25/05/2017",
  name_pan_card: null,
  pan_status: "VALID",
  pan_status_code: "E",
  pan_status_desc: "Existing and Valid",
  aadhaar_seeding_status_desc: "Aadhaar seeding is not applicable.",
};

export const PAN_INVALID = {
  pan: "ABCPV1234D",
  reference_id: 17974435,
  name_provided: null,
  valid: false,
  message: "Invalid PAN",
  name_match_score: 0,
  name_match_result: "-",
  pan_status_code: "N",
  pan_status_desc: "Not found in ITD database or Invalid PAN",
};

export const BANK_VALID = {
  reference_id: 34,
  name_at_bank: "BHARATHTEST GKUMARUT",
  bank_name: "YES BANK",
  city: "MUMBAI",
  branch: "SANTACRUZ, MUMBAI",
  micr: 400532038,
  name_match_score: "90.00",
  name_match_result: "GOOD_PARTIAL_MATCH",
  account_status: "VALID",
  account_status_code: "ACCOUNT_IS_VALID",
  utr: "404223241811",
  ifsc_details: {
    bank: "YES BANK",
    ifsc: "YESB0000262",
    ifsc_subcode: "YESB0",
    address: "GROUND FLOOR, 123, ABC CIRCLE, XYZ MAIN ROAD, MUMBAI - 560098",
    city: "MUMBAI",
    state: "MAHARASHTRA",
    branch: "SANTACRUZ, MUMBAI",
    category: "SUB_MEMBER",
    swift_code: "ABCDINBBDCL",
    micr: 560751026,
    nbin: 1234,
  },
};

const NULL_IFSC_DETAILS = { bank: null, ifsc: null, ifsc_subcode: null, address: null, city: null, state: null, branch: null, category: null, swift_code: null, micr: null, nbin: null };

export const BANK_INVALID_ACCOUNT = {
  reference_id: 34,
  name_at_bank: null,
  bank_name: null,
  city: null,
  branch: null,
  micr: null,
  name_match_score: null,
  name_match_result: null,
  account_status: "INVALID",
  account_status_code: "INVALID_ACCOUNT_FAIL",
  utr: null,
  ifsc_details: NULL_IFSC_DETAILS,
};

export const BANK_BLOCKED = { ...BANK_INVALID_ACCOUNT, account_status_code: "ACCOUNT_BLOCKED" };

export const UDYAM_SUCCESS = {
  verification_id: "tfqgzsXu3Z",
  reference_id: 3478283,
  status: "SUCCESS",
  udyam_number: "UDYAM-UP-43-1234567",
  enterprise_name: "helloscholar",
  organization_type: "Proprietary",
  major_activity: "Services",
  social_category: "General",
  date_of_incorporation: "2020-05-29",
  date_of_commencement: "2020-05-29",
  date_of_udyam_registration: "2022-01-02",
  enterprise_type: "Micro",
  classification_year: "2024-25",
  classification_date: "2025-06-02",
  udyam_certificate_url: "UDYAM_CERTIFICATE_PDF_URL",
  classification_history: [{ serial_number: "1", classification_year: "2024-25", enterprise_type: "Micro", classification_date: "2025-06-02" }],
  split_address: {
    flat: "Ground Floor",
    building: "05 Raman Vihar",
    village: "Naubasta",
    block: "Naubasta",
    street: "Naubasta",
    city: "Kanpur",
    district: "KANPUR NAGAR",
    state: "UTTAR PRADESH",
    pincode: "208021",
    mobile: "70*****210",
    email: "helloscholar.edu@gmail.com",
  },
  unit_locations: [],
  nic_codes: [],
  dic: "KANPUR NAGAR",
  msme_di: "KANPUR",
};

const NULL_UDYAM = {
  udyam_number: null,
  enterprise_name: null,
  organization_type: null,
  major_activity: null,
  social_category: null,
  date_of_incorporation: null,
  date_of_commencement: null,
  date_of_udyam_registration: null,
  enterprise_type: null,
  classification_year: null,
  classification_date: null,
  udyam_certificate_url: null,
  classification_history: [],
  split_address: null,
  unit_locations: [],
  nic_codes: [],
  dic: null,
  msme_di: null,
};

export const UDYAM_NOT_FOUND = { verification_id: "kIagmEcyQd", reference_id: 3689515, status: "UDYAM_NOT_FOUND", ...NULL_UDYAM };
export const UDYAM_CANCELLED = { verification_id: "xYzAbCdEfG", reference_id: 3689516, status: "UDYAM_IS_CANCELLED", ...NULL_UDYAM };

export const ERRORS = {
  authFailed: { type: "authentication_error", code: "authentication_failed", message: "Invalid clientId and clientSecret combination" },
  ipNotWhitelisted: { type: "authentication_error", code: "ip_validation_failed", message: "IP not whitelisted your current ip is 106.51.91.104." },
  clientIdMissing: { type: "validation_error", code: "x-client-id_missing", message: "x-client-id is missing in the request." },
  insufficientBalance: { type: "validation_error", code: "insufficient_balance", message: "Insufficient balance to process this request" },
  rateLimited: { type: "rate_limit_error", code: "too_many_requests_per_operation", message: "Too many requests for this operation, rate limit reached" },
  sourceDown: { type: "internal_error", code: "verification_failed", message: "Authorised source is temporarily unavailable, please try again shortly" },
  gstinInvalid: { type: "validation_error", code: "GSTIN_value_invalid", message: "GSTIN first 2 digits should be numeric and length should not exceed 15 and should be alphanumeric." },
  ifscInvalid: { type: "validation_error", code: "ifsc_value_invalid", message: "ifsc should be of 11 characters and 5th character should be 0." },
  fraudAccount: { type: "validation_error", code: "fraud_account", message: "Fraud activity detected for this account.", error: { reference_id: 102 } },
  npciUnavailable: { type: "validation_error", code: "npci_unavailable", message: "npci unavailable.", error: { reference_id: 102 } },
  underProcess: { type: "validation_error", code: "verification_already_under_process", message: "verification already under process.", error: { reference_id: 102 } },
  verificationIdExists: { type: "validation_error", code: "verification_id_already_exists", message: "verification ID already exists" },
};
