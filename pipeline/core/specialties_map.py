"""Medicare specialty code -> CMS PFS impact-table specialty.

CMS does not publish this crosswalk with the CY2027 impact file. It is built
from the Medicare provider/supplier specialty code list (CMS Pub. 100-04,
ch. 26, sec. 10.8.2) and checked against the impact table's allowed charges
(column C) in tests: see test_core.py::test_specialty_allowed_matches_cms.
"""

SPEC_TO_IMPACT = {
    "01": "GENERAL PRACTICE",
    "02": "GENERAL SURGERY",
    "03": "ALLERGY/IMMUNOLOGY",
    "04": "OTOLARNGOLOGY",  # sic, CMS's spelling in the impact table
    "05": "ANESTHESIOLOGY",
    "06": "CARDIOLOGY",
    "07": "DERMATOLOGY",
    "08": "FAMILY PRACTICE",
    "09": "INTERVENTIONAL PAIN MGMT",
    "10": "GASTROENTEROLOGY",
    "11": "INTERNAL MEDICINE",
    "12": "GENERAL PRACTICE",  # osteopathic manipulative medicine (closest fit to CMS column C)
    "13": "NEUROLOGY",
    "14": "NEUROSURGERY",
    "15": "PHYSICAL/OCCUPATIONAL THERAPY",  # speech-language pathologist
    "16": "OBSTETRICS/GYNECOLOGY",
    "17": "MULTISPECIALTY CLINIC/OTHER PHYS",  # hospice and palliative care
    "18": "OPHTHALMOLOGY",
    "19": "ORAL/MAXILLOFACIAL SURGERY",
    "20": "ORTHOPEDIC SURGERY",
    "21": "CARDIOLOGY",  # cardiac electrophysiology
    "22": "PATHOLOGY",
    "23": "FAMILY PRACTICE",  # sports medicine (closest fit to CMS column C)
    "24": "PLASTIC SURGERY",
    "25": "PHYSICAL MEDICINE",
    "26": "PSYCHIATRY",
    "27": "PSYCHIATRY",  # geriatric psychiatry
    "28": "COLON AND RECTAL SURGERY",
    "29": "PULMONARY DISEASE",
    "30": "RADIOLOGY",
    "31": "OTHER",  # intensive cardiac rehabilitation
    "32": "NURSE ANES / ANES ASST",
    "33": "THORACIC SURGERY",
    "34": "UROLOGY",
    "35": "CHIROPRACTIC",
    "36": "NUCLEAR MEDICINE",
    "37": "PEDIATRICS",
    "38": "GERIATRICS",
    "39": "NEPHROLOGY",
    "40": "HAND SURGERY",
    "41": "OPTOMETRY",
    "42": "OTHER",  # certified nurse midwife
    "43": "NURSE ANES / ANES ASST",
    "44": "INFECTIOUS DISEASE",
    "45": "OTHER",  # mammography center
    "46": "ENDOCRINOLOGY",
    "47": "DIAGNOSTIC TESTING FACILITY",
    "48": "PODIATRY",
    "50": "NURSE PRACTITIONER",
    "60": "OTHER",
    "62": "CLINICAL PSYCHOLOGIST",  # psychologist (billing independently)
    "63": "PORTABLE X-RAY SUPPLIER",
    "64": "AUDIOLOGIST",
    "65": "PHYSICAL/OCCUPATIONAL THERAPY",
    "66": "RHEUMATOLOGY",
    "67": "PHYSICAL/OCCUPATIONAL THERAPY",
    "68": "CLINICAL PSYCHOLOGIST",
    "69": "INDEPENDENT LABORATORY",
    "70": "MULTISPECIALTY CLINIC/OTHER PHYS",
    "71": "OTHER",  # registered dietitian
    "72": "INTERVENTIONAL PAIN MGMT",  # pain management
    "73": "OTHER",
    "74": "RADIATION ONCOLOGY AND RADIATION THERAPY CENTERS",
    "75": "INDEPENDENT LABORATORY",  # slide preparation facility
    "76": "VASCULAR SURGERY",  # peripheral vascular disease
    "77": "VASCULAR SURGERY",
    "78": "CARDIAC SURGERY",
    "79": "PSYCHIATRY",  # addiction medicine
    "80": "CLINICAL SOCIAL WORKER",
    "81": "CRITICAL CARE",
    "82": "HEMATOLOGY/ONCOLOGY",
    "83": "HEMATOLOGY/ONCOLOGY",
    "84": "MULTISPECIALTY CLINIC/OTHER PHYS",  # preventive medicine
    "85": "ORAL/MAXILLOFACIAL SURGERY",
    "86": "PSYCHIATRY",  # neuropsychiatry
    "87": "OTHER",
    "88": "OTHER",
    "89": "NURSE PRACTITIONER",  # clinical nurse specialist
    "90": "HEMATOLOGY/ONCOLOGY",  # medical oncology
    "91": "GENERAL SURGERY",  # surgical oncology
    "92": "RADIATION ONCOLOGY AND RADIATION THERAPY CENTERS",
    "93": "EMERGENCY MEDICINE",
    "94": "INTERVENTIONAL RADIOLOGY",
    "97": "PHYSICIAN ASSISTANT",
    "98": "OBSTETRICS/GYNECOLOGY",  # gynecologic oncology
    "99": "MULTISPECIALTY CLINIC/OTHER PHYS",  # unknown physician specialty
    "A5": "OTHER",
    "C0": "MULTISPECIALTY CLINIC/OTHER PHYS",  # sleep medicine
    "C1": "OTHER",
    "C3": "CARDIOLOGY",  # interventional cardiology
    "C5": "ORAL/MAXILLOFACIAL SURGERY",  # dentist
    "C6": "INTERNAL MEDICINE",  # hospitalist
    "C7": "CARDIOLOGY",  # advanced heart failure and transplant cardiology
    "C8": "MULTISPECIALTY CLINIC/OTHER PHYS",  # medical toxicology
    "C9": "HEMATOLOGY/ONCOLOGY",  # hematopoietic cell transplantation
    "D3": "MULTISPECIALTY CLINIC/OTHER PHYS",  # medical genetics and genomics
    "D4": "MULTISPECIALTY CLINIC/OTHER PHYS",  # undersea and hyperbaric medicine
    "D5": "OTHER",
    "D6": "OTHER",
    "D7": "DERMATOLOGY",  # micrographic dermatologic surgery
    "D8": "CARDIOLOGY",  # adult congenital heart disease
    "E1": "CLINICAL SOCIAL WORKER",  # marriage and family therapist (fits CMS column C)
    "E2": "CLINICAL SOCIAL WORKER",  # mental health counselor (fits CMS column C)
}
