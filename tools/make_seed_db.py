#!/usr/bin/env python3
"""Generate data/clinical_prompts_db.json (hand-seeded sample, unreviewed).

Usage:  uv run --no-project tools/make_seed_db.py
Standard library only. Re-uses normalize()/validate_db() from validate_db.py.
"""
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from validate_db import normalize, validate_db  # noqa: E402

OUT = HERE.parent / "data" / "clinical_prompts_db.json"
SRC = "hand-seeded sample (unreviewed)"
TRAP = -10


def A(name, score, aliases=(), pearl=None):
    d = {"name": name, "aliases": list(aliases), "score": score}
    if pearl:
        d["pearl"] = pearl
    return d


# --------------------------------------------------------------------------
# 1. Fever of unknown origin
# --------------------------------------------------------------------------
FUO = [
    # Plankton
    A("Tuberculosis", 4, ["miliary tuberculosis", "extrapulmonary tuberculosis", "Mycobacterium tuberculosis"]),
    A("Infective endocarditis", 5, ["endocarditis", "bacterial endocarditis", "subacute bacterial endocarditis", "SBE"]),
    A("Lymphoma", 5, ["Hodgkin lymphoma", "non-Hodgkin lymphoma", "Hodgkin disease"]),
    A("Leukemia", 9, ["acute leukemia", "leukaemia"]),
    A("Occult abscess", 7, ["intra-abdominal abscess", "hepatic abscess", "liver abscess", "splenic abscess", "subphrenic abscess", "pelvic abscess", "psoas abscess"]),
    A("Drug fever", 10, ["drug-induced fever", "medication fever"]),
    A("Systemic lupus erythematosus", 7, ["SLE", "lupus"]),
    A("Giant cell arteritis", 12, ["temporal arteritis", "GCA"]),
    A("Osteomyelitis", 11, ["vertebral osteomyelitis", "discitis"]),
    A("Renal cell carcinoma", 13, ["RCC", "hypernephroma", "kidney cancer"]),
    A("Crohn's disease", 15, ["regional enteritis", "Crohn disease of the ileum"]),
    A("Sarcoidosis", 14, []),
    A("Venous thromboembolism", 15, ["VTE", "pulmonary embolism", "deep vein thrombosis", "DVT"]),
    A("Adult-onset Still's disease", 14, ["AOSD", "Still disease", "adult Still disease"]),
    # Board Prep Traps
    A("Familial Mediterranean fever", TRAP, ["FMF", "familial paroxysmal polyserositis"],
      "FMF (MEFV mutations) causes recurrent 1-3 day fevers with serositis and responds to colchicine."),
    A("Hemophagocytic lymphohistiocytosis", TRAP, ["HLH", "haemophagocytic lymphohistiocytosis", "hemophagocytic syndrome"],
      "Look for fever, cytopenias, very high ferritin, hypertriglyceridemia and splenomegaly, and search for the trigger (infection, lymphoma)."),
    A("Whipple disease", TRAP, ["Tropheryma whipplei"],
      "Tropheryma whipplei can cause prolonged fever with arthralgia, weight loss and diarrhea, diagnosed by PAS-positive macrophages or PCR."),
    # Senior resident / fellow
    A("Polymyalgia rheumatica", 20, ["PMR"]),
    A("Cholangitis", 22, ["ascending cholangitis", "biliary tract infection"]),
    A("Granulomatosis with polyangiitis", 25, ["GPA", "Wegener granulomatosis"]),
    A("Epstein-Barr virus infection", 25, ["EBV", "infectious mononucleosis", "mono"]),
    A("Polyarteritis nodosa", 28, ["PAN"]),
    A("Cytomegalovirus infection", 30, ["CMV"]),
    A("Malaria", 30, ["Plasmodium infection"]),
    A("Takayasu arteritis", 30, ["Takayasu disease", "pulseless disease"]),
    A("Hyperthyroidism", 33, ["thyrotoxicosis", "Graves disease"]),
    A("Subacute thyroiditis", 35, ["de Quervain thyroiditis", "granulomatous thyroiditis"]),
    A("Histoplasmosis", 35, ["Histoplasma capsulatum"]),
    A("Behcet disease", 38, ["Behcet syndrome", "Adamantiades-Behcet disease"]),
    A("Brucellosis", 40, ["undulant fever", "Malta fever", "Brucella infection"]),
    A("Mycobacterium avium complex", 40, ["MAC", "disseminated MAC", "MAI"]),
    A("Typhoid fever", 40, ["enteric fever", "Salmonella typhi"]),
    A("Toxoplasmosis", 42, ["Toxoplasma gondii infection"]),
    A("Amebic liver abscess", 45, ["Entamoeba histolytica abscess"]),
    A("Bartonellosis", 45, ["cat scratch disease", "Bartonella henselae"]),
    A("Q fever", 45, ["Coxiella burnetii"]),
    A("Adrenal insufficiency", 45, ["Addison disease", "adrenal crisis"]),
    A("Hypersensitivity pneumonitis", 50, ["extrinsic allergic alveolitis"]),
    A("Atrial myxoma", 50, ["cardiac myxoma", "left atrial myxoma"]),
    A("Factitious fever", 50, ["self-induced fever", "Munchausen syndrome"]),
    A("Anaplasmosis", 55, ["ehrlichiosis", "human granulocytic anaplasmosis"]),
    A("Leptospirosis", 55, ["Weil disease"]),
    A("Relapsing polychondritis", 55, []),
    A("Visceral leishmaniasis", 55, ["kala-azar", "leishmaniasis"]),
    A("Lemierre syndrome", 55, ["septic jugular vein thrombophlebitis", "necrobacillosis"]),
    A("Babesiosis", 60, ["Babesia infection"],
      "Tick-borne Babesia can cause prolonged fever with hemolysis, and is more severe after splenectomy or in immunosuppression."),
    A("Central fever", 60, ["hypothalamic fever", "neurogenic fever"],
      "Central fever is a diagnosis of exclusion and characteristically does not respond to antipyretics."),
    A("Sweet syndrome", 60, ["acute febrile neutrophilic dermatosis"],
      "Acute febrile neutrophilic dermatosis; it can accompany hematologic malignancy, infection, or drugs such as G-CSF."),
    A("Aortic graft infection", 60, ["infected vascular graft", "vascular graft infection"],
      "Low-grade fever after vascular grafting may be graft infection, best identified with FDG-PET or CT."),
    A("Adult Kawasaki disease", 62, ["Kawasaki disease", "mucocutaneous lymph node syndrome"],
      "Kawasaki disease is rare in adults and is easily missed; persistent fever with rash, conjunctivitis and adenopathy should prompt consideration."),
    A("Tick-borne relapsing fever", 62, ["relapsing fever", "Borrelia hermsii"],
      "Borrelia spirochetes cause recurrent febrile episodes separated by afebrile intervals."),
    A("Murine typhus", 65, ["Rickettsia typhi", "endemic typhus"],
      "Flea-borne Rickettsia typhi causes prolonged fever, headache and rash, and responds to doxycycline."),
    A("Tularemia", 65, ["Francisella tularensis", "rabbit fever"],
      "Francisella tularensis can present as prolonged fever after rabbit, tick or deer-fly exposure."),
    A("Macrophage activation syndrome", 68, ["MAS"],
      "A secondary HLH-like state complicating rheumatic disease, especially Still's disease and systemic JIA."),
    A("Melioidosis", 70, ["Burkholderia pseudomallei", "Whitmore disease"],
      "Burkholderia pseudomallei from endemic soil and water (Southeast Asia, northern Australia) can mimic TB with chronic fever and abscesses."),
    A("Angioimmunoblastic T-cell lymphoma", 70, ["AITL"],
      "Presents with fever, generalized adenopathy, rash, hypergammaglobulinemia and often autoimmune phenomena."),
    A("Pelvic septic thrombophlebitis", 70, ["septic pelvic vein thrombosis", "ovarian vein thrombosis"],
      "Postpartum or postsurgical fever persisting despite antibiotics may reflect septic pelvic vein thrombosis, treated with anticoagulation."),
    A("PFAPA syndrome", 70, ["PFAPA", "periodic fever aphthous stomatitis pharyngitis adenitis"],
      "Periodic fever, aphthous stomatitis, pharyngitis and adenitis is usually pediatric but adult-onset cases are described."),
    A("BCG infection", 75, ["disseminated BCG", "BCG-itis"],
      "Disseminated BCG after intravesical therapy can produce months of fever with granulomatous hepatitis or pneumonitis."),
    # One in a Zebra
    A("Schnitzler syndrome", 80, [],
      "Chronic urticarial rash plus monoclonal IgM gammopathy with fever and bone pain; responds to IL-1 blockade."),
    A("Rat-bite fever", 80, ["Streptobacillus moniliformis", "Spirillum minus infection", "sodoku"],
      "Streptobacillus moniliformis or Spirillum minus causes relapsing fever, rash and migratory arthritis after rodent exposure."),
    A("SAPHO syndrome", 80, ["chronic recurrent multifocal osteomyelitis", "CRMO"],
      "Sterile osteitis with fever and bone pain, often with palmoplantar pustulosis or acne."),
    A("Cryopyrin-associated periodic syndromes", 82, ["CAPS", "Muckle-Wells syndrome", "NOMID", "familial cold autoinflammatory syndrome"],
      "NLRP3 gain-of-function causes fever with urticaria-like rash and responds to IL-1 inhibition."),
    A("Multicentric Castleman disease", 82, ["Castleman disease", "angiofollicular lymph node hyperplasia"],
      "IL-6 driven lymphoproliferative disorder (HHV-8 in some HIV patients) causing fever, adenopathy and cytopenias."),
    A("TNF receptor-associated periodic syndrome", 84, ["TRAPS", "familial Hibernian fever"],
      "Autosomal dominant TNFRSF1A mutations cause prolonged febrile attacks with migratory myalgia and periorbital edema."),
    A("Kikuchi-Fujimoto disease", 84, ["histiocytic necrotizing lymphadenitis", "Kikuchi disease"],
      "Self-limited fever with tender cervical lymphadenopathy, seen mostly in young women, diagnosed by lymph node biopsy."),
    A("Cyclic neutropenia", 85, ["cyclical neutropenia"],
      "ELANE mutations cause roughly 21-day cycles of neutropenia with fever, mouth ulcers and infections."),
    A("Chronic meningococcemia", 85, ["chronic meningococcal infection"],
      "Neisseria meningitidis can cause weeks of intermittent fever, rash and arthralgia, with positive blood cultures."),
    A("Mevalonate kinase deficiency", 86, ["hyper-IgD syndrome", "hyperimmunoglobulin D syndrome", "HIDS"],
      "MVK deficiency causes periodic fever with lymphadenopathy, abdominal pain and elevated IgD, and mevalonic aciduria during attacks."),
    A("Hepatosplenic T-cell lymphoma", 88, ["HSTCL"],
      "Aggressive gamma-delta T-cell lymphoma with fever, hepatosplenomegaly and cytopenias, mostly in young men with long immunosuppression."),
    A("Intravascular large B-cell lymphoma", 88, ["intravascular lymphoma", "IVLBCL", "angiotropic lymphoma"],
      "A classic hidden cause of FUO with high LDH and few nodes; random skin biopsy can be diagnostic."),
    A("VEXAS syndrome", 90, ["UBA1-associated autoinflammatory syndrome"],
      "Somatic UBA1 mutation in older men causing fevers, macrocytic anemia, chondritis, neutrophilic dermatosis and vacuolated myeloid precursors."),
    A("Erdheim-Chester disease", 90, ["ECD"],
      "A non-Langerhans histiocytosis, often BRAF V600E mutated, with long-bone sclerosis, retroperitoneal fibrosis and constitutional symptoms."),
    A("Chronic active Epstein-Barr virus disease", 90, ["chronic active EBV", "CAEBV"],
      "Persistent EBV-driven T/NK lymphoproliferation with fever, hepatosplenomegaly and lymphadenopathy."),
    A("TAFRO syndrome", 92, ["thrombocytopenia anasarca fever reticulin fibrosis organomegaly"],
      "Castleman variant with thrombocytopenia, anasarca, fever, reticulin fibrosis or renal dysfunction, and organomegaly."),
    A("Deficiency of adenosine deaminase 2", 92, ["DADA2", "ADA2 deficiency"],
      "Biallelic ADA2 mutations cause fever, livedo, early-onset stroke and polyarteritis nodosa-like vasculitis."),
]

# --------------------------------------------------------------------------
# 2. Warfarin potentiators
# --------------------------------------------------------------------------
WARF = [
    # Plankton
    A("Aspirin", 5, ["ASA", "acetylsalicylic acid"]),
    A("NSAIDs", 6, ["nonsteroidal anti-inflammatory drugs", "ibuprofen", "naproxen", "diclofenac", "ketorolac"]),
    A("Trimethoprim-sulfamethoxazole", 8, ["TMP-SMX", "Bactrim", "Septra", "co-trimoxazole", "cotrimoxazole"]),
    A("Ciprofloxacin", 12, ["Cipro"]),
    A("Clopidogrel", 12, ["Plavix"]),
    A("Heparin", 8, ["unfractionated heparin", "enoxaparin", "low molecular weight heparin", "LMWH"]),
    A("Fluconazole", 11, ["Diflucan"]),
    A("Alcohol", 15, ["acute alcohol intoxication", "binge drinking", "ethanol"]),
    A("Acetaminophen", 15, ["paracetamol", "Tylenol"]),
    # Board Prep Traps
    A("Amiodarone", TRAP, ["Cordarone", "Pacerone"],
      "Amiodarone inhibits CYP2C9 and CYP3A4 and typically requires about a 30-50% warfarin dose reduction; the effect lingers for months after stopping."),
    A("Cimetidine", TRAP, ["Tagamet"],
      "Cimetidine inhibits several CYP enzymes, including those clearing R-warfarin, and raises INR; famotidine does not meaningfully."),
    A("Metronidazole", TRAP, ["Flagyl"],
      "Metronidazole inhibits CYP2C9 metabolism of S-warfarin and can raise INR sharply within days."),
    # Senior
    A("Levofloxacin", 28, ["Levaquin"]),
    A("Clarithromycin", 25, ["Biaxin"]),
    A("Azithromycin", 30, ["Zithromax"]),
    A("Erythromycin", 28, ["Ery-Tab"]),
    A("Voriconazole", 35, ["Vfend"]),
    A("Omeprazole", 40, ["Prilosec"]),
    A("Allopurinol", 40, ["Zyloprim"]),
    A("Ceftriaxone", 40, ["Rocephin"]),
    A("Simvastatin", 45, ["Zocor"]),
    A("Amoxicillin-clavulanate", 45, ["Augmentin", "co-amoxiclav"]),
    A("Itraconazole", 45, ["Sporanox"]),
    A("SSRIs", 30, ["selective serotonin reuptake inhibitors", "SNRIs", "serotonin norepinephrine reuptake inhibitors"],
      "SSRIs impair platelet serotonin uptake, adding bleeding risk without necessarily changing INR."),
    A("Doxycycline", 50, ["Vibramycin"]),
    A("Ketoconazole", 50, ["Nizoral"]),
    A("Rosuvastatin", 50, ["Crestor"]),
    A("Fenofibrate", 50, ["Tricor"]),
    A("Levothyroxine", 50, ["thyroid hormone", "Synthroid"],
      "Thyroid hormone increases catabolism of vitamin K-dependent clotting factors, so starting or increasing it raises warfarin sensitivity."),
    A("Fish oil", 50, ["omega-3 fatty acids"]),
    A("Ginkgo biloba", 50, ["ginkgo"]),
    A("Fluoxetine", 55, ["Prozac"]),
    A("Lovastatin", 55, ["Mevacor"]),
    A("Gemfibrozil", 55, ["Lopid"]),
    A("Propafenone", 55, ["Rythmol"]),
    A("Tramadol", 55, ["Ultram"]),
    A("Cefotetan", 60, ["cefoperazone"],
      "Cephalosporins with an N-methylthiotetrazole side chain (e.g., cefotetan, cefoperazone) can cause hypoprothrombinemia."),
    A("Ticlopidine", 60, ["Ticlid"],
      "Adds antiplatelet bleeding risk; now rarely used because of neutropenia and TTP."),
    A("Celecoxib", 62, ["Celebrex"],
      "Celecoxib is metabolized by CYP2C9 and can raise INR even though it spares platelet COX-1."),
    A("Tamoxifen", 62, ["Nolvadex"],
      "Tamoxifen has been reported to markedly raise INR with serious bleeding in patients on warfarin."),
    A("Vitamin E", 62, ["alpha-tocopherol", "tocopherol"],
      "High-dose vitamin E has antiplatelet effects and may antagonize vitamin K-dependent clotting."),
    A("Fluvastatin", 65, ["Lescol"],
      "Fluvastatin inhibits CYP2C9, the main metabolic route of S-warfarin."),
    A("Quinidine", 65, ["quinidine sulfate"],
      "Quinidine has been associated with reduced vitamin K-dependent factor levels and potentiated anticoagulation."),
    A("Dong quai", 70, ["Angelica sinensis"],
      "Contains coumarin derivatives; case reports describe INR elevation."),
    A("Fluorouracil", 70, ["5-FU", "5-fluorouracil"],
      "Fluorouracil has been reported to increase INR with warfarin, possibly by inhibiting warfarin metabolism."),
    A("Testosterone", 70, ["androgens", "methyltestosterone"],
      "Androgen labeling warns of increased sensitivity to oral anticoagulants, so INR should be monitored."),
    A("Dronedarone", 70, ["Multaq"],
      "Dronedarone labeling reports INR increases and bleeding in patients on warfarin."),
    A("Isoniazid", 75, ["INH"],
      "Isoniazid inhibits hepatic enzymes and has been reported to raise INR, an interaction that is easy to miss."),
    A("Oxandrolone", 72, ["Oxandrin"],
      "Anabolic steroids such as oxandrolone markedly increase warfarin sensitivity, often requiring large dose reductions."),
    A("Turmeric", 72, ["curcumin"],
      "Curcumin has antiplatelet activity that adds to bleeding risk."),
    A("Danazol", 75, ["Danocrine"],
      "Danazol, a synthetic androgen, increases warfarin effect and can precipitate bleeding."),
    A("Capecitabine", 80, ["Xeloda"],
      "Capecitabine labeling warns of altered coagulation parameters and bleeding, including death, in patients on warfarin."),
    A("Disulfiram", 78, ["Antabuse"],
      "Disulfiram inhibits CYP2C9 and raises S-warfarin exposure."),
    A("Leflunomide", 78, ["Arava"],
      "Leflunomide labeling reports INR increases with concomitant warfarin."),
    # Zebra
    A("Miconazole", 80, ["Monistat", "Oravig"],
      "Even oral-gel and vaginal miconazole can inhibit CYP2C9 and cause marked INR elevations."),
    A("Zileuton", 80, ["Zyflo"],
      "Zileuton labeling recommends prothrombin time monitoring and warfarin dose adjustment."),
    A("Tigecycline", 80, ["Tygacil"],
      "Tigecycline labeling reports prolonged PT and aPTT and advises monitoring with warfarin."),
    A("Zafirlukast", 82, ["Accolate"],
      "Zafirlukast inhibits CYP2C9 and labeling advises monitoring the prothrombin time with warfarin."),
    A("Sulfinpyrazone", 82, ["Anturane"],
      "Sulfinpyrazone inhibits metabolism of S-warfarin and also has antiplatelet effects."),
    A("Orlistat", 82, ["Xenical", "Alli"],
      "Orlistat can reduce vitamin K absorption; INR changes have been reported in patients on warfarin."),
    A("Chloral hydrate", 84, ["Noctec"],
      "Its metabolite trichloroacetic acid displaces warfarin from albumin, transiently increasing anticoagulant effect."),
    A("Danshen", 85, ["Salvia miltiorrhiza"],
      "Salvia miltiorrhiza has been associated with case-reported INR elevations and bleeding with warfarin."),
    A("Stanozolol", 85, ["Winstrol"],
      "Anabolic steroid long known to potentiate warfarin markedly."),
    A("Argatroban", 86, ["Acova"],
      "Argatroban prolongs the INR directly, so transition to warfarin requires adjusted targets or a chromogenic factor X assay."),
    A("Boldo-fenugreek", 92, ["boldo and fenugreek", "Peumus boldus"],
      "A case report described markedly raised INR with a boldo-fenugreek herbal preparation."),
]

# --------------------------------------------------------------------------
# 3. Atypical MI presentations
# --------------------------------------------------------------------------
MI = [
    # Plankton
    A("Dyspnea", 4, ["isolated dyspnea", "shortness of breath", "dyspnoea", "SOB"]),
    A("Nausea and vomiting", 8, ["nausea", "vomiting"]),
    A("Diaphoresis", 8, ["sweating", "cold sweat"]),
    A("Fatigue", 10, ["unusual tiredness", "malaise", "generalized weakness"]),
    A("Back pain", 12, ["interscapular pain", "upper back pain", "pain between the shoulder blades"]),
    A("Neck pain", 14, []),
    A("Shoulder pain", 14, ["isolated shoulder pain"]),
    A("Syncope", 15, ["fainting", "loss of consciousness", "presyncope"]),
    # Board Prep Traps
    A("Silent myocardial infarction", TRAP, ["painless MI", "painless myocardial infarction", "asymptomatic MI", "unrecognized MI", "silent MI"],
      "Silent MI is more common in diabetes and the elderly and is often found later as Q waves on ECG."),
    A("Epigastric pain", TRAP, ["indigestion", "heartburn", "dyspepsia", "GERD-like pain"],
      "Inferior MI frequently presents with epigastric discomfort, nausea and vagal symptoms."),
    A("Jaw pain", TRAP, ["dental pain", "toothache", "mandibular pain"],
      "Jaw or tooth pain, especially if exertional, can be an anginal equivalent."),
    # Senior
    A("Orthopnea or paroxysmal nocturnal dyspnea", 25, ["PND", "orthopnea"]),
    A("Acute heart failure", 18, ["flash pulmonary edema", "new onset heart failure", "acute decompensated heart failure", "acute pulmonary edema"]),
    A("Cardiac arrest", 16, ["ventricular fibrillation", "sudden cardiac death", "sudden death"]),
    A("Ventricular tachycardia", 28, ["new onset ventricular tachycardia"]),
    A("Palpitations", 22, ["palpitation", "racing heart"]),
    A("Acute confusion", 25, ["delirium", "altered mental status", "acute encephalopathy"]),
    A("Anxiety or sense of impending doom", 24, ["panic attack", "impending doom"]),
    A("Cardiogenic shock", 30, ["hypotension", "cardiogenic shock without chest pain"]),
    A("Atrial fibrillation", 32, ["new onset atrial fibrillation", "afib"]),
    A("Bradycardia or AV block", 30, ["heart block", "complete heart block", "atrioventricular block"]),
    A("Throat tightness", 30, ["choking sensation", "throat pain", "globus"]),
    A("Abdominal pain mimicking acute abdomen", 28, ["RUQ pain", "biliary colic-like pain", "pancreatitis mimic", "cholecystitis mimic"]),
    A("Pleuritic chest pain", 35, ["sharp chest pain", "positional chest pain", "pleuritic pain"]),
    A("Right-sided chest pain", 35, ["right chest pain"]),
    A("Cough", 38, ["isolated cough", "dry cough"]),
    A("Falls", 34, ["unexplained fall", "mechanical fall"]),
    A("Wheezing", 40, ["cardiac asthma", "new onset asthma"]),
    A("Hyperglycemic crisis", 40, ["diabetic ketoacidosis", "new hyperglycemia", "hyperosmolar state"]),
    A("Isolated right arm pain", 40, ["right arm pain"]),
    A("Dizziness", 45, ["lightheadedness", "vertigo"]),
    A("Reproducible chest wall tenderness", 45, ["chest wall tenderness", "musculoskeletal-type chest pain"]),
    A("Type 2 myocardial infarction", 48, ["demand ischemia", "supply-demand mismatch", "MI from sepsis or anemia"]),
    A("Arm or hand numbness", 50, ["left arm numbness", "paresthesias", "ulnar pain"]),
    A("Sleep disturbance", 55, ["insomnia", "prodromal insomnia"]),
    A("Fever", 55, ["low grade fever"]),
    A("Diarrhea", 55, ["loose stools"]),
    A("Stroke", 60, ["embolic stroke", "cardioembolic stroke", "hemiparesis", "left ventricular thrombus embolism"],
      "Left ventricular mural thrombus after anterior MI can embolize, so stroke or limb ischemia may be the first apparent event."),
    A("Papillary muscle rupture", 62, ["acute mitral regurgitation", "acute mitral regurgitation from papillary muscle rupture"],
      "A late-presenting MI can declare itself by flash pulmonary edema from papillary muscle rupture, most often the posteromedial muscle in inferior MI."),
    A("Ventricular septal rupture", 62, ["post-infarction VSD", "septal rupture"],
      "Typically occurs days after an infarct and presents with new harsh holosystolic murmur and shock."),
    A("Ventricular free wall rupture", 65, ["cardiac tamponade", "myocardial rupture", "free wall rupture"],
      "Free wall rupture classically occurs days to a week after transmural MI and presents with sudden pulseless electrical activity or tamponade."),
    A("Seizure", 68, ["convulsive syncope", "anoxic convulsion"],
      "Arrhythmic cerebral hypoperfusion can cause convulsive activity that is mistaken for a primary seizure."),
    A("Spontaneous coronary artery dissection", 78, ["SCAD", "peripartum MI"],
      "SCAD should be considered in young or peripartum women with MI and few traditional risk factors."),
    A("Coronary embolism", 80, ["coronary artery embolism", "embolic myocardial infarction"],
      "MI in a young patient without atherosclerosis may be embolic, from atrial fibrillation, endocarditis or a prosthetic valve."),
    A("Kounis syndrome", 88, ["allergic myocardial infarction", "allergic angina"],
      "Acute coronary syndrome triggered by an allergic or anaphylactic reaction with mast cell mediator release."),
    A("de Winter T-wave pattern", 88, ["de Winter ST-T complex", "de Winter sign"],
      "Upsloping ST depression with tall symmetric T waves in the precordial leads is a STEMI equivalent indicating proximal LAD occlusion."),
    A("Tongue pain", 92, ["glossalgia", "lingual pain"],
      "Isolated tongue pain has been reported as an anginal equivalent in case reports."),
    A("Wellens syndrome", 75, ["Wellens pattern", "Wellens T waves"],
      "Biphasic or deeply inverted T waves in V2-V3 in a pain-free interval indicate critical proximal LAD stenosis."),
    A("Posterior myocardial infarction", 70, ["posterior MI", "isolated posterior infarction"],
      "ST depression in V1-V3 with tall R waves may be a posterior STEMI equivalent and is confirmed with posterior leads V7-V9."),
    A("Right ventricular infarction", 70, ["RV infarction"],
      "Hypotension with clear lungs and elevated JVP in inferior MI suggests RV involvement; avoid preload reduction such as nitrates."),
    A("New left bundle branch block", 65, ["Sgarbossa criteria", "LBBB"],
      "Concordant ST changes by the Sgarbossa criteria can reveal MI in the presence of LBBB."),
    A("Vasospastic angina", 65, ["Prinzmetal angina", "coronary vasospasm"],
      "Rest pain, often at night or early morning, with transient ST elevation due to coronary vasospasm."),
    A("Early post-infarction pericarditis", 62, ["pericarditis-like chest pain"],
      "Pleuritic, positional pain with friction rub within days of a transmural MI."),
    A("Perioperative myocardial infarction", 55, ["postoperative MI"],
      "Postoperative MI is frequently asymptomatic and found on troponin surveillance."),
    A("Cocaine-associated myocardial infarction", 55, ["cocaine-induced MI"]),
    A("Ventricular pseudoaneurysm", 80, ["left ventricular pseudoaneurysm", "contained rupture"],
      "A contained myocardial rupture sealed by pericardium, which can present late with heart failure, embolism or arrhythmia."),
    # Zebra
    A("Hiccups", 82, ["persistent hiccups", "singultus"],
      "Persistent hiccups, particularly with inferior MI, have been reported as a presenting symptom."),
    A("Wrist pain", 85, ["wrist pain as anginal equivalent", "hand pain"],
      "Isolated wrist or hand pain has been reported as an anginal equivalent."),
    A("Vasovagal reaction", 85, ["Bezold-Jarisch reflex", "vagal reaction with inferior MI"],
      "Inferior MI can trigger the Bezold-Jarisch reflex, causing bradycardia and hypotension."),
    A("Ear pain", 88, ["otalgia", "earache", "cardiac otalgia"],
      "Referred ear pain has been reported as the only symptom of myocardial ischemia."),
]

# --------------------------------------------------------------------------
# 4. High anion gap metabolic acidosis
# --------------------------------------------------------------------------
HAGMA = [
    # Plankton
    A("Lactic acidosis", 2, ["lactate", "hyperlactatemia", "type A lactic acidosis"]),
    A("Diabetic ketoacidosis", 3, ["DKA"]),
    A("Uremia", 4, ["renal failure", "chronic kidney disease", "acute kidney injury", "kidney failure"]),
    A("Septic shock", 6, ["sepsis", "shock"]),
    A("Salicylate toxicity", 6, ["aspirin overdose", "salicylate poisoning", "aspirin toxicity"]),
    A("Methanol poisoning", 7, ["methanol ingestion", "wood alcohol", "methyl alcohol"]),
    A("Ethylene glycol poisoning", 8, ["antifreeze ingestion", "ethylene glycol ingestion", "ethylene glycol toxicity"]),
    A("Alcoholic ketoacidosis", 9, ["AKA"]),
    A("Starvation ketosis", 14, ["starvation ketoacidosis", "fasting ketoacidosis"]),
    A("Seizure", 15, ["generalized tonic-clonic seizure", "status epilepticus"]),
    A("Mesenteric ischemia", 15, ["bowel ischemia", "ischemic bowel"]),
    # Board Prep Traps
    A("Propylene glycol toxicity", TRAP, ["propylene glycol", "lorazepam infusion", "prolonged lorazepam infusion"],
      "High-dose IV lorazepam (propylene glycol diluent) can cause a high osmolar gap and lactic acidosis, mostly from D- and L-lactate."),
    A("Isoniazid toxicity", TRAP, ["isoniazid overdose", "INH toxicity"],
      "Isoniazid overdose causes refractory seizures and lactic acidosis, treated with IV pyridoxine."),
    A("Iron overdose", TRAP, ["iron toxicity", "ferrous sulfate overdose"],
      "Severe iron poisoning causes lactic acidosis through mitochondrial toxicity and hypoperfusion."),
    # Senior
    A("Strenuous exercise", 18, ["exertional lactic acidosis"]),
    A("Liver failure", 20, ["hepatic failure", "cirrhosis with impaired lactate clearance"]),
    A("Metformin-associated lactic acidosis", 22, ["MALA", "metformin toxicity", "biguanide-associated lactic acidosis"]),
    A("Euglycemic ketoacidosis with SGLT2 inhibitor", 30, ["euglycemic DKA", "SGLT2 inhibitor ketoacidosis", "empagliflozin ketoacidosis", "dapagliflozin ketoacidosis"]),
    A("Acetaminophen toxicity", 40, ["acetaminophen overdose", "paracetamol overdose"]),
    A("Carbon monoxide poisoning", 40, ["CO poisoning"]),
    A("Cyanide poisoning", 40, ["cyanide toxicity"]),
    A("Paraldehyde", 40, ["paraldehyde ingestion"]),
    A("Linezolid", 45, ["linezolid lactic acidosis", "Zyvox"]),
    A("Nitroprusside toxicity", 48, ["sodium nitroprusside", "nitroprusside cyanide toxicity"]),
    A("Nucleoside reverse transcriptase inhibitors", 50, ["NRTIs", "stavudine", "didanosine", "zidovudine"]),
    A("Propofol infusion syndrome", 52, ["PRIS", "propofol toxicity"]),
    A("Toluene toxicity", 55, ["glue sniffing", "toluene inhalation"]),
    A("Thiamine deficiency", 55, ["beriberi", "Shoshin beriberi", "wet beriberi"]),
    A("Beta-agonist induced lactic acidosis", 58, ["albuterol", "salbutamol", "epinephrine infusion"]),
    A("Theophylline toxicity", 58, ["theophylline overdose", "aminophylline toxicity"]),
    A("Malignancy-associated lactic acidosis", 62, ["Warburg effect", "type B lactic acidosis in lymphoma", "leukemia lactic acidosis"],
      "Aggressive hematologic malignancies can cause type B lactic acidosis from tumor glycolysis, sometimes responsive to chemotherapy."),
    A("Valproate toxicity", 65, ["valproic acid overdose", "valproate overdose"],
      "Valproate overdose can cause anion gap acidosis, hyperammonemia and CNS depression, and may be treated with hemodialysis."),
    A("Ibuprofen overdose", 65, ["massive ibuprofen ingestion", "NSAID overdose"],
      "Massive ibuprofen ingestion can cause anion gap acidosis, renal failure and coma."),
    A("Diethylene glycol poisoning", 70, ["diethylene glycol", "contaminated syrup"],
      "Diethylene glycol-contaminated medicines have caused outbreaks of anion gap acidosis and acute kidney injury."),
    A("D-lactic acidosis", 70, ["D-lactate acidosis", "short bowel syndrome acidosis"],
      "Short bowel with colonic bacterial overproduction of D-lactate causes encephalopathy and acidosis that the standard L-lactate assay misses."),
    A("Methylmalonic acidemia", 78, ["MMA", "methylmalonic aciduria"],
      "An organic acidemia causing ketoacidosis and hyperammonemia during metabolic decompensation."),
    A("Propionic acidemia", 78, ["propionic aciduria"],
      "An organic acidemia with episodic ketoacidosis and hyperammonemia, usually presenting in neonates."),
    # Zebra
    A("Maple syrup urine disease", 80, ["MSUD", "branched-chain ketoaciduria"],
      "Defective branched-chain ketoacid dehydrogenase causes ketoacidosis with sweet-smelling urine and encephalopathy."),
    A("Glycogen storage disease type I", 80, ["von Gierke disease", "glucose-6-phosphatase deficiency"],
      "Fasting hypoglycemia with lactic acidosis, hyperuricemia and hypertriglyceridemia."),
    A("Mitochondrial disease", 80, ["MELAS", "mitochondrial encephalomyopathy", "respiratory chain disorder"],
      "Respiratory chain defects such as MELAS can cause chronic or stress-triggered lactic acidosis."),
    A("Isovaleric acidemia", 82, ["isovaleric aciduria"],
      "A leucine catabolism defect with ketoacidosis and sweaty-feet odor."),
    A("Pyruvate dehydrogenase deficiency", 82, ["PDH deficiency", "PDHA1 deficiency"],
      "PDH deficiency causes lactic acidosis that worsens with carbohydrate loading; ketogenic diet is therapeutic."),
    A("Hereditary fructose intolerance", 84, ["aldolase B deficiency", "HFI"],
      "Fructose ingestion causes hypoglycemia, lactic acidosis and liver injury."),
    A("5-Oxoproline accumulation", 85, ["pyroglutamic acidosis", "pyroglutamic acid", "glutathione synthetase deficiency", "5-oxoprolinemia"],
      "Chronic acetaminophen use in malnourished women, sepsis, renal failure, or flucloxacillin can produce unexplained high anion gap acidosis from 5-oxoproline."),
    A("Pyruvate carboxylase deficiency", 85, [],
      "Causes lactic acidosis with elevated lactate-to-pyruvate ratio and hyperammonemia in infants."),
    A("Methylene chloride exposure", 85, ["dichloromethane poisoning", "paint stripper exposure"],
      "Methylene chloride is metabolized to carbon monoxide, so carboxyhemoglobin rises after exposure."),
    A("Dinitrophenol toxicity", 85, ["2,4-dinitrophenol", "DNP overdose"],
      "A mitochondrial uncoupler causing hyperthermia, lactic acidosis, tachycardia and diaphoresis."),
    A("Fructose-1,6-bisphosphatase deficiency", 88, ["FBPase deficiency"],
      "A gluconeogenesis defect causing fasting hypoglycemia and lactic acidosis."),
    A("Biotinidase deficiency", 88, ["multiple carboxylase deficiency", "holocarboxylase synthetase deficiency"],
      "Causes organic aciduria, ketolactic acidosis, alopecia, rash and seizures, all treatable with biotin."),
    A("Aluminum phosphide poisoning", 88, ["phosphine poisoning", "rice tablet poisoning"],
      "Releases phosphine gas, causing refractory shock, severe lactic acidosis and arrhythmias."),
    A("Benzyl alcohol toxicity", 88, ["gasping syndrome"],
      "Benzyl alcohol preservative in neonates causes gasping syndrome with metabolic acidosis."),
    A("Beta-ketothiolase deficiency", 90, ["mitochondrial acetoacetyl-CoA thiolase deficiency", "T2 deficiency"],
      "Episodic severe ketoacidosis triggered by illness, with characteristic urinary 2-methyl-3-hydroxybutyrate and tiglylglycine."),
    A("HMG-CoA lyase deficiency", 90, ["3-hydroxy-3-methylglutaryl-CoA lyase deficiency"],
      "Causes hypoketotic hypoglycemia with metabolic acidosis and hyperammonemia during fasting."),
    A("Metaldehyde poisoning", 92, ["snail bait poisoning", "slug pellet ingestion"],
      "Metaldehyde causes seizures, hyperthermia and high anion gap metabolic acidosis."),
    A("Succinyl-CoA:3-oxoacid CoA transferase deficiency", 95, ["SCOT deficiency", "OXCT1 deficiency"],
      "Causes persistent ketosis and recurrent severe ketoacidosis episodes."),
]

# --------------------------------------------------------------------------
# 5. Paraneoplastic syndromes / antibodies (impossible)
# --------------------------------------------------------------------------
PARA = [
    # Plankton
    A("SIADH", 4, ["syndrome of inappropriate antidiuretic hormone secretion", "ectopic ADH secretion"]),
    A("Hypercalcemia of malignancy", 5, ["PTHrP secretion", "humoral hypercalcemia of malignancy"]),
    A("Ectopic ACTH syndrome", 6, ["paraneoplastic Cushing syndrome", "ectopic Cushing syndrome"]),
    A("Trousseau syndrome", 9, ["migratory thrombophlebitis", "cancer-associated hypercoagulability"]),
    A("Dermatomyositis", 10, ["paraneoplastic dermatomyositis"]),
    A("Paraneoplastic erythrocytosis", 14, ["ectopic erythropoietin", "erythropoietin-secreting tumor"]),
    A("Hypertrophic osteoarthropathy", 15, ["digital clubbing", "Pierre Marie-Bamberger syndrome", "HPOA"]),
    # Traps
    A("Lambert-Eaton myasthenic syndrome", TRAP, ["LEMS", "anti-VGCC antibodies", "P/Q-type calcium channel antibodies", "voltage-gated calcium channel antibodies"],
      "Proximal weakness with hyporeflexia that improves with repeated effort, most often with small cell lung cancer."),
    A("Anti-NMDAR encephalitis", TRAP, ["NMDA receptor encephalitis", "anti-NMDA receptor encephalitis"],
      "Psychiatric symptoms, seizures and dyskinesias in young women, often with ovarian teratoma."),
    A("Anti-Hu antibodies", TRAP, ["ANNA-1", "anti-neuronal nuclear antibody type 1", "anti-HuD", "paraneoplastic sensory neuronopathy"],
      "Classically associated with small cell lung cancer and sensory neuronopathy or encephalomyelitis."),
    # Senior
    A("Myasthenia gravis with thymoma", 16, ["acetylcholine receptor antibodies", "anti-AChR antibodies"]),
    A("Malignant acanthosis nigricans", 18, ["paraneoplastic acanthosis nigricans"]),
    A("Anti-Yo antibodies", 20, ["PCA-1", "anti-Purkinje cell antibody type 1", "anti-CDR2 antibodies"],
      "Associated with paraneoplastic cerebellar degeneration, most often with breast or gynecologic cancers."),
    A("Paraneoplastic cerebellar degeneration", 22, ["subacute cerebellar degeneration"]),
    A("Nonbacterial thrombotic endocarditis", 25, ["marantic endocarditis", "NBTE"]),
    A("Leser-Trelat sign", 28, ["sudden eruptive seborrheic keratoses"]),
    A("Non-islet cell tumor hypoglycemia", 30, ["Doege-Potter syndrome", "IGF-2 mediated hypoglycemia"]),
    A("Anti-Ri antibodies", 30, ["ANNA-2", "anti-neuronal nuclear antibody type 2", "anti-NOVA"]),
    A("Opsoclonus-myoclonus syndrome", 35, ["opsoclonus myoclonus ataxia"]),
    A("Sweet syndrome", 38, ["acute febrile neutrophilic dermatosis"]),
    A("Paraneoplastic pemphigus", 40, ["paraneoplastic autoimmune multiorgan syndrome", "PNP"]),
    A("Tumor-induced osteomalacia", 45, ["oncogenic osteomalacia", "FGF23 mediated hypophosphatemia"]),
    A("Anti-amphiphysin antibodies", 45, ["amphiphysin antibodies"]),
    A("Anti-GAD65 antibodies", 50, ["anti-glutamic acid decarboxylase antibodies", "GAD65 antibodies"]),
    A("Anti-CV2/CRMP5 antibodies", 50, ["CRMP5", "anti-CRMP5", "anti-CV2"]),
    A("Erythema gyratum repens", 50, []),
    A("Anti-LGI1 antibodies", 48, ["LGI1 encephalitis", "anti-leucine-rich glioma inactivated 1"]),
    A("Anti-GABA-B receptor antibodies", 55, ["GABA-B receptor encephalitis", "anti-GABAB receptor"]),
    A("Paraneoplastic membranous nephropathy", 55, ["cancer-associated membranous nephropathy"]),
    A("Paraneoplastic neuromyotonia", 55, ["Isaacs syndrome", "acquired neuromyotonia"]),
    A("Anti-Ma2 antibodies", 58, ["anti-Ta", "anti-Ma", "Ma2 encephalitis"],
      "Classically associated with limbic and brainstem encephalitis in young men with testicular germ cell tumors."),
    # 60-79
    A("Anti-CASPR2 antibodies", 60, ["CASPR2 antibodies", "Morvan syndrome", "contactin-associated protein-like 2 antibodies"],
      "CASPR2 antibodies cause neuromyotonia, Morvan syndrome and limbic encephalitis, with thymoma in a subset."),
    A("Tripe palms", 60, ["acanthosis palmaris"],
      "Thickened velvety palms with exaggerated dermatoglyphics, strongly associated with underlying malignancy, especially lung and gastric cancer."),
    A("Anti-AMPA receptor antibodies", 62, ["AMPAR encephalitis", "anti-AMPAR"],
      "Limbic encephalitis often associated with thymoma, small cell lung, or breast cancer."),
    A("Anti-SOX1 antibodies", 62, ["AGNA", "anti-glial nuclear antibody"],
      "Strongly associated with small cell lung cancer, especially in Lambert-Eaton syndrome."),
    A("Anti-Tr antibodies", 62, ["anti-DNER", "DNER antibodies"],
      "Associated with cerebellar degeneration in Hodgkin lymphoma."),
    A("Necrolytic migratory erythema", 62, ["glucagonoma rash"],
      "Migratory erythematous eruption with erosions, characteristic of glucagonoma."),
    A("Pure red cell aplasia with thymoma", 62, ["thymoma-associated pure red cell aplasia"],
      "Pure red cell aplasia is a recognized thymoma-associated autoimmune disorder."),
    A("POEMS syndrome", 62, ["Crow-Fukase syndrome", "osteosclerotic myeloma"],
      "Plasma cell dyscrasia with VEGF-driven polyneuropathy, organomegaly, endocrinopathy, M-protein and skin changes."),
    A("Paraneoplastic gastrointestinal dysmotility", 65, ["paraneoplastic intestinal pseudo-obstruction", "enteric neuropathy"],
      "Anti-Hu related enteric neuropathy causes pseudo-obstruction, classically with small cell lung cancer."),
    A("Pityriasis rotunda", 90, ["pityriasis circinata"],
      "Round, scaly hyperpigmented patches reported with hepatocellular carcinoma and other malignancies."),
    A("Florid cutaneous papillomatosis", 90, ["florid papillomatosis"],
      "A variant of malignant acanthosis nigricans with wart-like papules, reported with gastric adenocarcinoma."),
    A("Paraneoplastic stiff-person syndrome", 55, ["stiff person syndrome"]),
    A("Anti-TIF1-gamma antibodies", 72, ["anti-p155", "anti-p155/140", "TIF1 gamma antibodies"],
      "Dermatomyositis with anti-TIF1-gamma antibodies carries a high association with cancer in adults."),
    A("Anti-Zic4 antibodies", 75, ["Zic4 antibodies"],
      "Seen with small cell lung cancer and cerebellar degeneration."),
    A("Good syndrome", 78, ["thymoma with hypogammaglobulinemia"],
      "Thymoma with adult-onset hypogammaglobulinemia causing recurrent infections."),
    A("Anti-striational muscle antibodies", 78, ["anti-titin antibodies", "anti-ryanodine receptor antibodies"],
      "Titin and ryanodine receptor antibodies are associated with thymoma and more severe myasthenia."),
    # 80-99
    A("Acquired C1 inhibitor deficiency with lymphoproliferative disease", 78, ["acquired angioedema", "C1 esterase inhibitor deficiency type 1"],
      "Acquired angioedema without urticaria may herald B-cell lymphoproliferative disease."),
    A("Anti-AQP4 antibodies with cancer", 80, ["paraneoplastic NMOSD", "aquaporin-4 antibodies"],
      "Neuromyelitis optica spectrum disorder can rarely be paraneoplastic, with lung or breast cancer."),
    A("Paraneoplastic acral vascular syndrome", 80, ["paraneoplastic acral vascular disease"],
      "Digital ischemia that often precedes cancer diagnosis."),
    A("Bazex syndrome", 80, ["acrokeratosis paraneoplastica"],
      "Psoriasiform acral eruption with nail dystrophy, associated with upper aerodigestive tract squamous carcinoma."),
    A("Anti-NXP2 antibodies", 80, ["anti-MJ antibodies"],
      "Dermatomyositis antibody associated with calcinosis and cancer in adults."),
    A("Anti-enolase antibodies", 82, ["alpha-enolase antibodies"],
      "Seen in cancer-associated retinopathy."),
    A("Anti-envoplakin and anti-periplakin antibodies", 85, ["anti-envoplakin antibodies", "anti-periplakin antibodies"],
      "Plakin autoantibodies are characteristic of paraneoplastic pemphigus."),
    A("Anti-glycine receptor antibodies", 85, ["GlyR antibodies"],
      "Cause progressive encephalomyelitis with rigidity and myoclonus; a minority are paraneoplastic."),
    A("Anti-GFAP antibodies", 85, ["GFAP astrocytopathy", "anti-glial fibrillary acidic protein antibodies"],
      "GFAP meningoencephalomyelitis is paraneoplastic in a minority, with ovarian teratoma and other tumors reported."),
    A("Multicentric reticulohistiocytosis", 85, [],
      "Erosive polyarthritis with cutaneous nodules; a malignancy is found in a significant minority of patients."),
    A("Hypertrichosis lanuginosa acquisita", 85, [],
      "Sudden growth of lanugo hair, associated with lung and colorectal cancers."),
    A("Anti-recoverin antibodies", 88, ["cancer-associated retinopathy", "CAR syndrome"],
      "Photoreceptor autoantibodies causing photosensitivity and progressive vision loss in lung cancer."),
    A("Anti-ganglionic acetylcholine receptor antibodies", 90, ["anti-alpha3 AChR antibodies", "autoimmune autonomic ganglionopathy"],
      "Cause pandysautonomia, which can be paraneoplastic in a subset."),
    A("Anti-NELL1 antibodies", 90, ["NELL1 membranous nephropathy"],
      "NELL1-associated membranous nephropathy has been linked to malignancy."),
    A("Palmar fasciitis and polyarthritis syndrome", 90, ["palmar fasciitis polyarthritis"],
      "Rapidly progressive palmar contractures with polyarthritis, often with ovarian cancer."),
    A("Anti-mGluR5 antibodies", 92, ["Ophelia syndrome", "metabotropic glutamate receptor 5 antibodies"],
      "Limbic encephalitis associated with Hodgkin lymphoma."),
    A("Melanoma-associated retinopathy", 95, ["MAR"],
      "Night blindness with electronegative ERG due to ON bipolar cell dysfunction in metastatic melanoma."),
    # Impossible
    A("Anti-KLHL11 antibodies", 100, ["Kelch-like protein 11 antibodies", "KLHL11 encephalitis"],
      "Rhombencephalitis with ataxia and hearing loss in men with testicular seminoma."),
    A("Anti-mGluR1 antibodies", 100, ["metabotropic glutamate receptor 1 antibodies"],
      "Associated with subacute cerebellar ataxia in Hodgkin lymphoma and other cancers."),
    A("Anti-DPPX antibodies", 100, ["dipeptidyl-peptidase-like protein 6 antibodies", "DPPX encephalitis"],
      "Causes encephalitis with hyperexcitability and prominent GI symptoms such as diarrhea; only a minority are paraneoplastic, with B-cell neoplasms reported."),
    A("Anti-PCA-2 antibodies", 100, ["Purkinje cell antibody type 2", "MAP1B antibodies"],
      "Associated with small cell lung cancer and multifocal neurologic syndromes."),
    A("Anti-ANNA-3 antibodies", 100, ["anti-neuronal nuclear antibody type 3", "anti-DACH1 antibodies"],
      "Neuronal nuclear antibody associated with lung cancer and neurologic syndromes."),
    A("Anti-ITPR1 antibodies", 100, ["anti-Sj antibodies", "anti-IP3R1 antibodies", "inositol 1,4,5-trisphosphate receptor type 1 antibodies"],
      "Cerebellar ataxia sometimes with neoplasia, including carcinomas of the lung and breast."),
    A("Anti-PKC-gamma antibodies", 100, ["protein kinase C gamma antibodies"],
      "Cerebellar ataxia antibody, associated with lung carcinoma in some patients."),
    A("Anti-CARP VIII antibodies", 100, ["carbonic anhydrase related protein VIII antibodies", "anti-CA8 antibodies"],
      "Cerebellar ataxia antibody reported in melanoma."),
    A("Anti-glutamate receptor delta-2 antibodies", 100, ["anti-GluD2 antibodies", "anti-GRID2 antibodies"],
      "Cerebellar ataxia antibody reported with tumors."),
    A("Anti-AP3B2 antibodies", 100, ["AP3B2 antibodies"],
      "Cerebellar ataxia antibody reported with neuroendocrine tumors."),
    A("Anti-TRPM1 antibodies", 100, ["anti-bipolar cell antibodies", "TRPM1 antibodies"],
      "Antibodies to TRPM1 on ON bipolar cells cause melanoma-associated retinopathy."),
    A("Bilateral diffuse uveal melanocytic proliferation", 100, ["BDUMP"],
      "Rapid vision loss with diffuse uveal melanocytic proliferation, usually with systemic carcinoma."),
]

PROMPTS = [
    dict(id="fuo-causes", category="Diagnostic Dilemmas", prompt="Name causes of fever of unknown origin (FUO).",
         difficulty="standard", answers=FUO),
    dict(id="warfarin-potentiators", category="Unexpected Drug Interactions",
         prompt="Name drugs that potentiate warfarin's anticoagulant effect (raise the INR or bleeding risk).",
         difficulty="standard", answers=WARF),
    dict(id="atypical-mi-presentations", category="Atypical Presentations of Common Diseases",
         prompt="Name unusual or atypical ways a myocardial infarction can present.",
         difficulty="standard", answers=MI),
    dict(id="high-anion-gap-acidosis-causes", category="Complex Pathophysiology",
         prompt="Name causes of high anion gap metabolic acidosis.",
         difficulty="standard", answers=HAGMA),
    dict(id="paraneoplastic-syndromes-antibodies", category="Complex Pathophysiology",
         prompt="Name paraneoplastic syndromes or the autoantibodies that define them.",
         difficulty="impossible", answers=PARA),
]


def tier(s):
    if s == TRAP:
        return "trap"
    if s <= 15:
        return "plankton"
    if s <= 79:
        return "senior"
    if s <= 99:
        return "zebra"
    return "impossible"


def main():
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8", errors="replace")
    prompts = []
    for p in PROMPTS:
        prompts.append({**p, "source": SRC})
    db = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "generator": "hand-seeded sample",
        "review_status": "unreviewed",
        "prompts": prompts,
    }

    # Extra checks beyond validate_db.
    extra = []
    for p in prompts:
        keys = {}
        ge60 = [a for a in p["answers"] if a["score"] >= 60]
        pearls = sum(1 for a in ge60 if a.get("pearl"))
        if ge60 and pearls / len(ge60) < 0.8:
            extra.append(f"{p['id']}: only {pearls}/{len(ge60)} answers >=60 have pearls")
        for a in p["answers"]:
            nn = normalize(a["name"])
            for al in a["aliases"]:
                if normalize(al) == nn:
                    extra.append(f"{p['id']}: alias {al!r} same as name {a['name']!r}")
                if len(al.strip()) < 3:
                    extra.append(f"{p['id']}: short alias {al!r}")
            if p["difficulty"] != "impossible" and a["score"] == 100:
                extra.append(f"{p['id']}: 100 on standard")
            if "pearl" in a and a["pearl"].count(". ") > 0:
                extra.append(f"{p['id']}: pearl may be multi-sentence: {a['name']!r}")
    warns = []
    errs = validate_db(db, 40, warns)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(db, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

    print(f"wrote {OUT}")
    for p in prompts:
        c = Counter(tier(a["score"]) for a in p["answers"])
        n = len(p["answers"])
        print(f"{p['id']}: {n} answers  " + "  ".join(f"{k}={c.get(k, 0)}" for k in ("plankton", "trap", "senior", "zebra", "impossible")))
        if n:
            ge60 = sum(1 for a in p["answers"] if a["score"] >= 60)
            print(f"    >=60: {ge60} ({100 * ge60 // n}%)")
    for w in warns:
        print("WARN:", w)
    for e in errs:
        print("ERROR:", e)
    for e in extra:
        print("EXTRA:", e)
    print(f"{len(errs)} errors, {len(warns)} warnings, {len(extra)} extra issues")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
