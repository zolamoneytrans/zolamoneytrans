# ═══════════════════════════════════════════════════════════════════
# PROMPT — AGENT ZOLA MONEY TRANS PORTAL
# For: Antigravity / Bolt / Lovable / v0 / any AI builder
# Stack: React + Tailwind CSS + Firebase (Auth + Firestore + Functions)
# ═══════════════════════════════════════════════════════════════════

## PROJECT OVERVIEW

Build a full-stack **Agent Portal** for **Zola Money Trans** — a Mobile Money aggregator operating in the Democratic Republic of Congo (DRC), developed by **Swazi Appli Lab SARL**.

Zola Money Trans connects all Mobile Money operators in DRC (M-Pesa/Vodacom, Airtel Money, Orange Money, Afrimoney) through a single unified platform. **Agents** are approved merchants who assist customers with money transfers and earn commissions on each transaction.

This portal has **two distinct applications** sharing the same Firebase backend:
1. **Agent Portal** — public sign-up + authenticated agent dashboard
2. **Admin Dashboard** — internal Zola team tool to manage agents, validate KYC, monitor transactions, and release commissions

---

## ═══ PART 1 — DESIGN SYSTEM ═══

### Brand Palette
```
--zola-navy:     #002B5C   /* primary dark — headers, text */
--zola-navy2:    #0D3B80   /* secondary navy */
--zola-purple:   #6B4EFF   /* app accent — buttons, highlights */
--zola-purple2:  #3D1FA5   /* deep purple */
--zola-gold:     #C9991A   /* brand gold — badges, CTAs */
--zola-gold-f:   #F2C94C   /* light gold */
--zola-red:      #CC0000   /* brand red (logo) */
--mpesa-green:   #00923F
--airtel-red:    #C8102E
--orange-mm:     #FF7900
--afrimoney:     #4B3FBF
--white:         #FFFFFF
--off-white:     #FFFEF8
--light-grey:    #F0EEF8
--text-dark:     #1A1A2E
--text-grey:     #64748B
--success:       #10B981
--warning:       #F59E0B
--danger:        #EF4444
--bg-dark:       #0A0820   /* for hero sections */
```

### Typography
- **Display/Headings**: `Inter` (700–900 weight) — for all headings, bold KPI numbers
- **Body**: `Inter` (400–600) — for paragraphs, labels, table text
- **Mono/Data**: `JetBrains Mono` — for transaction IDs, amounts, agent codes
- Font sizes: 12/14/16/18/24/32/48px scale

### Design Language
- **Rounded corners**: 8px cards, 12px modals, 20px badges/pills
- **Shadows**: `0 4px 20px rgba(0,0,0,0.08)` cards; `0 8px 32px rgba(107,78,255,0.15)` focus/active
- **Dark sidebar** (#0A0820) with white text for dashboard layout
- **Glass-morphism** effect on stat cards: `backdrop-filter: blur(10px)`
- **Mobile-first**, fully responsive — primary users are on phones
- **Operator colour-coding** throughout: M-Pesa=green, Airtel=red, Orange=orange, Afrimoney=purple

---

## ═══ PART 2 — AGENT SIGN-UP FLOW ═══

### Route: `/agent/signup`

Build a **multi-step wizard** (4 steps, progress bar at top) — NOT a single long form.

---

#### STEP 1 — Personal Information
Fields:
- `lastName` (required)
- `firstName` (required)
- `phone` (required, format +243XXXXXXXXX, with DRC flag prefix selector)
- `whatsapp` (optional, defaults to phone)
- `email` (required, validated)
- `password` (required, min 8 chars, strength indicator)
- `confirmPassword`
- `idType` (dropdown: "Carte Nationale d'Identité" | "Passeport" | "Permis de conduire")
- `idNumber` (required)
- `idUpload` (file upload: front + back, accept image/*, max 5MB each, with preview thumbnail)

UI notes:
- Show password strength meter (weak/medium/strong) with coloured bar
- Phone field: DRC flag + +243 prefix locked, user types remaining digits
- ID upload: drag-and-drop zone with camera icon, shows thumbnail on upload

---

#### STEP 2 — Business / Point of Sale
Fields:
- `businessName` (required — enseigne/nom commercial)
- `businessType` (dropdown: Kiosque | Boutique | Pharmacie | Épicerie | Supermarché | Salon | Restaurant | Autre)
- `province` (dropdown: Kinshasa | Lubumbashi | Goma | Bukavu | Mbuji-Mayi | Kisangani | Matadi | Autre)
- `commune` (text, required)
- `quartier` (text, required)
- `address` (textarea, required)
- `openingHours` (text, e.g. "Lun–Sam 7h–20h")
- `rccm` (text, optional)
- `nif` (text, optional)
- `businessPhoto` (file upload, photo of storefront, optional)

UI notes:
- Province/Commune cascade — selecting province suggests common communes
- Show a Google Maps embed (static) placeholder where they'll add location pin (Phase 2 note)

---

#### STEP 3 — Mobile Money Account (Commission Receipt)
UI: Four large **operator selection cards** in a 2×2 grid (on mobile) / row (on desktop).

Each card shows:
- Operator logo/colour block
- Operator name + network (e.g. "M-PESA — Vodacom DRC")
- Radio button / tap-to-select
- When selected: card highlights with operator colour border + checkmark badge

Selected operator reveals:
- `mmPhone` — Mobile Money phone number (format +243XXXXXXXXX)
- Info text: "Vos commissions hebdomadaires seront créditées sur ce compte."

Operators:
```
{ id: "mpesa",     label: "M-PESA",      network: "Vodacom DRC",  color: "#00923F" }
{ id: "airtel",    label: "AIRTEL MONEY", network: "Airtel DRC",   color: "#C8102E" }
{ id: "orange",    label: "ORANGE MONEY", network: "Orange RDC",   color: "#FF7900" }
{ id: "afrimoney", label: "AFRIMONEY",    network: "Africell DRC", color: "#4B3FBF" }
```

Fields:
- `selectedOperator` (required, one of above)
- `mmPhone` (required, validated)

---

#### STEP 4 — Documents Upload + Confirmation
Upload fields:
- `selfie` — Photo d'identité récente (selfie avec pièce d'identité, required)
- `proofOfAddress` — Photo du point de vente / façade (required)
- `mmScreenshot` — Capture du compte Mobile Money (numéro visible, required)
- `rccmDoc` — RCCM document (optional PDF or image)

Each upload zone shows:
- Dashed border with upload icon
- Label + "Obligatoire" or "Recommandé" badge
- File name + size after upload
- Remove button (×)

Declaration checkboxes (all must be checked to proceed):
```
☐ J'ai lu et j'accepte le Guide de Commission Agent Zola Money Trans
☐ Je m'engage à respecter la grille tarifaire officielle Zola
☐ Je m'engage à maintenir un float suffisant pour les retraits clients
☐ Je m'engage à vérifier l'identité des clients pour toute transaction > 200 000 CDF
☐ Je certifie que toutes les informations fournies sont exactes et sincères
```

**Submit button**: "Soumettre ma candidature →"

On submit:
1. Create Firebase Auth user (email + password)
2. Write Firestore document to `agents/{uid}` with all fields + `status: "pending"` + `createdAt` + `agentCode: null` + `commissions: { total: 0, pending: 0, released: 0 }`
3. Upload files to Firebase Storage at `agents/{uid}/documents/`
4. Send welcome email via Firebase Functions (Cloud Function trigger)
5. Show success screen:
   - ✅ Green checkmark animation
   - "Candidature reçue !"
   - "Votre dossier est en cours d'examen. Vous recevrez une réponse sous 24 à 48 heures par SMS et email."
   - Reference number: `ZMT-AG-{timestamp}`
   - WhatsApp button → wa.me/243857767040

---

#### SIGN-IN PAGE — Route: `/agent/login`

Fields: email + password
- "Mot de passe oublié ?" → Firebase password reset
- "Créer un compte Agent →" link to signup
- Show status banner if account is pending/suspended

---

## ═══ PART 3 — AGENT DASHBOARD ═══

### Route: `/agent/dashboard` (protected, requires auth + status === "approved")

If `status === "pending"` → show a holding page: "Votre compte est en cours de validation. Délai : 24–48h."
If `status === "suspended"` → show suspended page with contact info.

---

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  SIDEBAR (dark, collapsible on mobile)                   │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ Logo Zola +     │  │  TOP BAR                     │  │
│  │ Agent name      │  │  Search | Notifs | Avatar    │  │
│  │ Status badge    │  ├──────────────────────────────┤  │
│  │                 │  │                              │  │
│  │ Nav items:      │  │  PAGE CONTENT                │  │
│  │ • Tableau bord  │  │                              │  │
│  │ • Transactions  │  │                              │  │
│  │ • Commissions   │  │                              │  │
│  │ • Mon profil    │  │                              │  │
│  │ • Documents     │  │                              │  │
│  │ • Support       │  │                              │  │
│  └─────────────────┘  └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

Sidebar items:
- 🏠 Tableau de bord
- ↔ Transactions
- 💰 Mes Commissions
- 👤 Mon Profil
- 📁 Mes Documents
- 💬 Support
- 🚪 Déconnexion

---

### Page 1 — Tableau de Bord (Home)

**Section A — Welcome + Status Bar**
```
Bonjour, [Prénom] 👋
Agent Zola Money Trans  •  [Badge statut: Actif / Premium ★ / Elite ★★]
N° Agent : ZMT-AG-XXXXX
```

**Section B — KPI Cards (4 cards, 2×2 mobile / 4×1 desktop)**
```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ 💰 Commissions  │ │ ↔ Transactions │ │ 📊 Volume total │ │ 🏆 Performance  │
│  semaine        │  │  ce mois        │ │  ce mois        │ │  ce mois        │
│                 │ │                 │ │                 │ │                 │
│  12 500 CDF     │ │  47             │ │  2 340 000 CDF  │ │  Agent Actif    │
│  ↑ +15% / S-1  │ │  +8 vs sem. préc│ │                 │ │  → 53 tx/objectif│
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
```

Card design: white background, coloured top border (3px), gold number, grey subtitle.

**Section C — Commission Progress Bar**
```
Objectif Agent Actif (100 transactions/mois)
████████████░░░░░░░░ 47 / 100  [47%]
Prochain palier : +53 transactions → Bonus 15 000 CDF
```

Animated progress bar in `--zola-gold`, shows current tier + next tier.

**Section D — Recent Transactions (last 5)**
Mini table:
- Date | Type | Opérateur (coloured badge) | Montant | Commission | Statut

**Section E — Commission Timeline (Chart)**
Bar chart (last 8 weeks):
- X-axis: week labels
- Y-axis: commission in CDF
- Bars coloured by operator mix
- Use Recharts or Chart.js

---

### Page 2 — Transactions

**Filters bar:**
- Date range picker (this week / this month / custom)
- Operator filter (All | M-Pesa | Airtel | Orange | Afrimoney)
- Type filter (All | Dépôt | Retrait | Transfert | Facture)
- Search (transaction ID or phone number)

**Table columns:**
| Ref. | Date/Heure | Type | Client (masked: +243 8X XXX XXX) | Opérateur | Montant | Frais | Commission | Statut |

Statuts:
- ✅ Confirmé (green)
- ⏳ En cours (yellow)
- ❌ Échoué (red)

Pagination: 20 rows/page
Export button: "Télécharger CSV"

**Transaction detail modal** (click any row):
- Full transaction details
- Timeline: Initié → Envoyé opérateur → Confirmé → Commission calculée
- Download receipt PDF button

---

### Page 3 — Mes Commissions

**Section A — Summary Cards**
```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Total cumulé     │  │ En attente       │  │ Déjà versé       │
│ 125 000 CDF      │  │ 18 500 CDF       │  │ 106 500 CDF      │
│ Depuis création  │  │ Prochain versem. │  │ Historique       │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

**Section B — Commission Breakdown Table**
Group by week:
| Semaine | Transactions | Dépôts comm. | Retraits comm. | Transferts comm. | Bonus | Total | Statut versement |

Statut versement: 
- 🟡 En attente (awaiting admin release)
- 🟢 Versé (paid, with date)
- 🔴 Suspendu (suspended, with reason)

**Section C — Payment History**
Timeline list of all past commission releases:
```
✅ 15 Juin 2026 — 18 500 CDF → M-PESA +243 81X XXX XXX
✅ 08 Juin 2026 — 21 000 CDF → M-PESA +243 81X XXX XXX
```

**Section D — Commission Tiers Progress**
Visual card showing current tier + all tiers:
```
Débutant     → 50 tx → Bonus 5 000 CDF
Actif        → 100 tx → Bonus 15 000 CDF   ← Vous êtes ici
Confirmé     → 200 tx → Bonus 35 000 CDF
Senior       → 500 tx → Bonus 100 000 CDF
Premium ★    → 1000 tx → Bonus 250 000 CDF
Elite ★★     → 1000+ tx + commission +5%
```

---

### Page 4 — Mon Profil

Editable profile sections:
- Personal info (read-only: name, ID number | editable: phone, email, WhatsApp)
- Business info (editable: address, hours, business type)
- Commission account (operator + MM number — edit requires admin approval)
- Password change
- Notification preferences (SMS | Email | WhatsApp — toggles)

Profile completion progress bar: "Profil complété à 85% — Ajoutez votre RCCM pour atteindre 100%"

---

### Page 5 — Mes Documents

Grid of uploaded documents with status badges:
- CNI/Passeport: ✅ Vérifié | ⏳ En attente | ❌ Rejeté
- Photo identité: same
- Photo point de vente: same
- Relevé Mobile Money: same
- RCCM: ➕ Ajouter (if missing)
- NIF: ➕ Ajouter (if missing)

Each document: thumbnail/icon + status badge + upload date + re-upload button if rejected (with rejection reason shown).

---

### Page 6 — Support

- FAQ accordion (top 8 most common questions)
- Contact card: WhatsApp button (+243 857 767 040) + email link
- Ticket form: Subject | Message | Submit
- Ticket history table (if any open/closed tickets)

---

## ═══ PART 4 — ADMIN DASHBOARD ═══

### Route: `/admin` (separate auth role: `role === "admin"` in Firestore)

> This is the internal Zola Money Trans management tool for the team.

---

### Admin Layout

Same sidebar layout as Agent dashboard but different nav:
- 📊 Vue d'ensemble
- 👥 Gestion Agents
- ✅ Validations KYC
- 💰 Commissions
- ↔ Transactions
- 📣 Notifications
- ⚙ Paramètres
- 🚪 Déconnexion

Admin sidebar accent colour: `--zola-purple` instead of gold.

---

### Admin Page 1 — Vue d'Ensemble (Dashboard)

**Top KPI bar (6 cards):**
```
Agents total | Agents actifs | En attente validation | Commissions dues | Volume semaine | Transactions aujourd'hui
847           | 612           | 23                    | 1 240 500 CDF    | 45 000 000 CDF | 2 847
```

All real-time from Firestore aggregates.

**Charts row:**
- Line chart: Daily transactions (last 30 days), lines per operator (M-Pesa green, Airtel red, Orange orange, Afrimoney purple)
- Donut chart: Commission distribution by operator this month
- Bar chart: New agents registered per week (last 8 weeks)

**Recent activity feed (right panel):**
Live updates:
```
🟡 Nouveau dossier Agent — Jean Mukeba (Kinshasa) — il y a 3 min
✅ KYC Approuvé — Marie Kabila — il y a 12 min
💰 Commission versée — 12 500 CDF → Agent ZMT-AG-0047 — il y a 28 min
⚠ Transaction suspecte signalée — il y a 1h
```

**Map widget:** Show agent distribution across DRC provinces (bubble map — bubble size = agent count).

---

### Admin Page 2 — Gestion des Agents

**Table with search + filters:**

Filters: Status (All | Pending | Active | Suspended) | Province | Operator | Date joined | Tier

Table columns:
| N° Agent | Nom complet | Province | Opérateur | Statut | Transactions ce mois | Comm. due | Date inscription | Actions |

Status badges:
- 🟡 En attente
- 🟢 Actif
- ⭐ Premium
- 🔴 Suspendu
- ⚫ Fermé

**Actions per row:**
- 👁 Voir dossier complet
- ✅ Approuver (if pending)
- ❌ Suspendre / Réactiver
- 💰 Voir commissions
- ✉ Envoyer message

**Agent Detail Modal / Slide-over panel:**
Tabbed layout:
- Tab 1 — **Informations**: All personal + business info, ID documents with preview
- Tab 2 — **KYC**: Document verification status, approve/reject each document individually with text reason
- Tab 3 — **Transactions**: Full transaction history for this agent
- Tab 4 — **Commissions**: Commission history + pending amount + release button
- Tab 5 — **Activité**: Login history, last seen, device

---

### Admin Page 3 — Validations KYC

**Kanban-style board with 3 columns:**

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ 🟡 EN ATTENTE   │  │ 🔵 EN RÉVISION  │  │ ✅ TRAITÉS      │
│   (23)          │  │   (4)           │  │ aujourd'hui(12) │
│                 │  │                 │  │                 │
│ [Agent card]    │  │ [Agent card]    │  │ [Agent card]    │
│ [Agent card]    │  │                 │  │ [Agent card]    │
│ ...             │  │                 │  │ ...             │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

Each KYC card shows:
- Agent name + photo thumbnail
- Submission date + time ago
- Province
- Documents submitted (icons: ✅ uploaded / ❌ missing)
- "Examiner →" button

**KYC Review Panel** (full screen):
Split layout:
- Left: Document viewer (image/PDF with zoom, rotate)
- Right: Checklist + decision

Checklist:
```
☐ CNI/Passeport — valide et lisible
☐ Photo identité — claire et récente
☐ Photo point de vente — localisable
☐ Relevé Mobile Money — numéro visible
☐ Informations cohérentes
```

Decision buttons:
- ✅ "Approuver et activer le compte" → updates status to "approved", generates agent code (ZMT-AG-{seq}), sends welcome SMS/email
- ❌ "Rejeter" → requires reason text (dropdown + free text) → sends rejection notification with reasons

Auto-generate agent code on approval:
```javascript
// Format: ZMT-AG-{4-digit-sequence}
// e.g. ZMT-AG-0001, ZMT-AG-0002
```

---

### Admin Page 4 — Commissions

**Tabs:** Dues | Versées | Historique complet

**TAB 1 — Commissions dues (Release Queue)**

Header summary:
```
Total en attente : 2 450 000 CDF  |  47 agents  |  Prochain versement programmé : Vendredi 20 Juin
```

Table:
| Agent | N° Agent | Opérateur | N° compte MM | Montant dû | Période | Transactions | Sélectionner |

Top actions:
- "Tout sélectionner" checkbox
- "Verser la sélection" button (primary, gold) → confirmation modal
- "Exporter CSV" button

**Commission Release Modal:**
```
Confirmer le versement groupé

Vous allez verser des commissions à 12 agents
Montant total : 156 500 CDF
Opérateurs : M-Pesa (7), Airtel (3), Orange (2)

⚠ Cette action est irréversible. Vérifiez les montants avant de confirmer.

[ Annuler ]  [ ✅ Confirmer le versement ]
```

On confirm:
1. Update each agent's `commissions.pending` → 0, `commissions.released` += amount
2. Create release record in `commissionReleases/` collection
3. Update `lastReleaseDate`, `lastReleaseAmount`
4. Send push notification + SMS to each agent: "Votre commission de X CDF a été créditée sur votre compte [Opérateur]."
5. Show success toast: "12 versements traités avec succès"

**TAB 2 — Versées**

Table: Agent | Montant | Opérateur | N° compte | Date versement | Versé par (admin name) | Référence

**TAB 3 — Historique complet**

Full ledger with date range filter and CSV export.

---

### Admin Page 5 — Transactions

Global transaction view across all agents.

**Filters:** Date range | Agent search | Operator | Type | Status | Amount range

**Table:** Same as agent view but includes "Agent" column

**Suspicious transactions** marked with ⚠ icon — click to flag for AML review.

**Bulk export:** Full CSV / Excel for accounting reconciliation.

---

### Admin Page 6 — Notifications & Communications

**Send targeted message:**
- Target: All agents | By status | By operator | By province | Individual agent
- Channel: Push notification | SMS | Email | WhatsApp (manual link)
- Subject + Body (rich text editor)
- Schedule (now | scheduled date/time)
- Preview before send

**Notification history:** Table of all sent notifications with open rate (if available).

**Notification templates** (predefined):
- Commission versée
- KYC approuvé / rejeté
- Nouveau bonus disponible
- Mise à jour tarifaire (14 days notice)
- Compte suspendu / réactivé

---

### Admin Page 7 — Paramètres

**Section A — Commission Configuration**
Editable commission grid (mirrors the official tariff table):
```
Cash-in tiers:     [edit table rows + percentages]
Cash-out tiers:    [edit table rows + percentages]
Transfer rates:    [edit percentages per type]
Performance tiers: [edit thresholds + bonus amounts]
```
Save button → writes to `config/commissions` in Firestore, effective from date selector.

**Section B — Admin Users**
List of admin accounts with roles (superadmin | operator | readonly)
Add / remove / change role

**Section C — System Settings**
- Min float warning threshold
- Max transaction limits per tier
- Suspension rules (auto-suspend after X consecutive failed transactions)
- KYC document expiry reminder (days before expiry)

---

## ═══ PART 5 — FIREBASE DATA MODEL ═══

### Firestore Collections

```javascript
// agents/{uid}
{
  uid: string,
  agentCode: string | null,          // ZMT-AG-XXXX (set on approval)
  status: "pending" | "approved" | "suspended" | "closed",
  tier: "debutant" | "actif" | "confirme" | "senior" | "premium" | "elite",
  
  // Personal
  firstName: string,
  lastName: string,
  email: string,
  phone: string,
  whatsapp: string,
  idType: string,
  idNumber: string,
  
  // Business
  businessName: string,
  businessType: string,
  province: string,
  commune: string,
  quartier: string,
  address: string,
  openingHours: string,
  rccm: string | null,
  nif: string | null,
  
  // Commission account
  selectedOperator: "mpesa" | "airtel" | "orange" | "afrimoney",
  mmPhone: string,
  
  // Documents (Storage paths)
  documents: {
    idFront: string,
    idBack: string,
    selfie: string,
    businessPhoto: string,
    mmScreenshot: string,
    rccmDoc: string | null,
  },
  kyc: {
    idVerified: boolean,
    selfieVerified: boolean,
    businessVerified: boolean,
    mmVerified: boolean,
    verifiedBy: string | null,
    verifiedAt: timestamp | null,
    rejectionReasons: string[] | null,
  },
  
  // Commissions
  commissions: {
    total: number,        // cumulative all-time (CDF)
    pending: number,      // awaiting release
    released: number,     // already paid out
    lastReleaseDate: timestamp | null,
    lastReleaseAmount: number,
  },
  
  // Stats (updated by Cloud Functions)
  stats: {
    transactionsThisMonth: number,
    transactionsAllTime: number,
    volumeThisMonth: number,
    volumeAllTime: number,
    lastTransactionAt: timestamp | null,
  },
  
  createdAt: timestamp,
  updatedAt: timestamp,
  approvedAt: timestamp | null,
  approvedBy: string | null,
}

// transactions/{txId}
{
  txId: string,
  agentUid: string,
  agentCode: string,
  type: "cashin" | "cashout" | "transfer" | "bill",
  operator: "mpesa" | "airtel" | "orange" | "afrimoney",
  amount: number,            // in CDF
  fees: number,
  agentCommission: number,   // calculated commission for this agent
  customerPhone: string,     // masked in agent view
  reference: string,
  status: "pending" | "confirmed" | "failed",
  flagged: boolean,          // AML flag
  createdAt: timestamp,
  confirmedAt: timestamp | null,
}

// commissionReleases/{releaseId}
{
  releaseId: string,
  agentUid: string,
  agentCode: string,
  amount: number,
  operator: string,
  mmPhone: string,
  period: string,           // "2026-W24" (ISO week)
  transactionCount: number,
  releasedBy: string,       // admin uid
  releasedAt: timestamp,
  status: "processed" | "failed",
}

// config/commissions  (single document)
{
  cashin: [
    { min: 500, max: 5000, type: "fixed", value: 50 },
    { min: 5001, max: 20000, type: "percent", value: 0.004 },
    // ...
  ],
  cashout: [
    { min: 500, max: 5000, clientFee: 100, agentShare: 0.45 },
    // ...
  ],
  transfer: { agentShare: 0.40 },
  performanceTiers: [
    { min: 50,   max: 99,   bonus: 5000,   tier: "actif" },
    { min: 100,  max: 199,  bonus: 15000,  tier: "confirme" },
    { min: 200,  max: 499,  bonus: 35000,  tier: "senior" },
    { min: 500,  max: 999,  bonus: 100000, tier: "premium" },
    { min: 1000, max: null, bonus: 250000, commissionBonus: 0.05, tier: "elite" },
  ],
}

// adminUsers/{uid}
{
  uid: string,
  name: string,
  email: string,
  role: "superadmin" | "operator" | "readonly",
  createdAt: timestamp,
}

// notifications/{notifId}
{
  agentUid: string | "broadcast",
  type: "commission" | "kyc" | "system" | "bonus",
  title: string,
  body: string,
  read: boolean,
  createdAt: timestamp,
}
```

---

## ═══ PART 6 — CLOUD FUNCTIONS ═══

Implement these Firebase Cloud Functions:

```javascript
// 1. onAgentCreated — triggered on new agent document
// → send welcome email + SMS
// → notify admins of new pending KYC

// 2. onAgentApproved — triggered when status changes to "approved"
// → generate agent code (ZMT-AG-{seq})
// → send approval SMS + email to agent with credentials
// → create empty stats document

// 3. calculateCommission(txData) — callable function
// → read commission config from Firestore
// → calculate agent commission based on type + amount
// → update transaction + agent commission totals

// 4. weeklyCommissionRollup — scheduled (every Friday 18:00 CAT)
// → aggregate all confirmed transactions for the week
// → calculate bonuses based on performance tiers
// → create pending commission release records
// → notify admins of pending releases

// 5. releaseCommissions(agentIds[]) — callable (admin only)
// → validate admin role
// → process commission releases
// → update agent commission balances
// → send payment notifications to agents
// → log release in commissionReleases

// 6. updateAgentTier — triggered on stats update
// → check current month transaction count
// → update tier if threshold crossed
// → notify agent of tier upgrade
```

---

## ═══ PART 7 — SECURITY RULES ═══

```javascript
// Firestore Security Rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Agents can read/write their own document
    match /agents/{uid} {
      allow read, update: if request.auth.uid == uid 
                          && request.auth.uid != null;
      allow create: if request.auth.uid == uid;
      // Sensitive fields (status, tier, commissions) — write only via Cloud Functions
    }
    
    // Transactions — agents can read own, write via Cloud Functions only
    match /transactions/{txId} {
      allow read: if request.auth.uid == resource.data.agentUid;
      allow write: if false; // Functions only
    }
    
    // Commission releases — read only for agent, write via Functions
    match /commissionReleases/{releaseId} {
      allow read: if request.auth.uid == resource.data.agentUid;
      allow write: if false;
    }
    
    // Config — read only (commission rates)
    match /config/{doc} {
      allow read: if request.auth != null;
      allow write: if false; // Admin SDK only
    }
    
    // Admin users — admin only
    match /adminUsers/{uid} {
      allow read, write: if get(/databases/$(database)/documents/adminUsers/$(request.auth.uid)).data.role in ["superadmin"];
    }
    
    // Notifications
    match /notifications/{notifId} {
      allow read: if request.auth.uid == resource.data.agentUid 
                  || resource.data.agentUid == "broadcast";
      allow write: if false;
    }
  }
}
```

---

## ═══ PART 8 — UI COMPONENT LIBRARY ═══

Build these reusable components:

```
<OperatorBadge operator="mpesa|airtel|orange|afrimoney" />
  → Coloured pill with operator name

<StatusBadge status="pending|approved|suspended|closed" />
  → Coloured badge with icon

<TierBadge tier="actif|senior|premium|elite" />
  → Styled badge with star for premium/elite

<CommissionCard amount={number} label={string} trend={number} />
  → KPI card with gold number, label, optional trend arrow

<TransactionTable transactions={[]} showAgent={boolean} />
  → Reusable table used in both agent + admin views

<DocumentUploadZone label={string} required={boolean} onUpload={fn} />
  → Drag-drop zone with preview

<KYCDocumentViewer url={string} onApprove={fn} onReject={fn} />
  → Admin document review component with zoom + decision

<CommissionReleaseModal agents={[]} onConfirm={fn} />
  → Bulk release confirmation dialog

<ProgressBar current={number} max={number} label={string} color={string} />
  → Animated commission/tier progress bar

<AgentAvatar name={string} agentCode={string} tier={string} />
  → Avatar with initials, code, and tier badge
```

---

## ═══ PART 9 — IMPORTANT CONTEXT ═══

### Language
- All UI text in **French** (the DRC is a French-speaking country)
- Amounts displayed in **CDF (Francs Congolais)** with option to toggle to **USD**
- 1 USD ≈ 2 800 CDF (fetch live rate from exchangerate-api.com or similar)
- Phone numbers always prefixed with **+243** (DRC country code)

### Mobile-First Priority
- Primary users are merchants in DRC using **Android smartphones on 3G/4G**
- Offline-capable for dashboard viewing (Service Worker caching)
- Touch-friendly: minimum 44px tap targets
- Fast load: lazy load images, minimal JS bundle

### Brand Voice (in UI copy)
- Warm but professional — "Bonjour [Prénom] 👋" not "Welcome, User"
- Action-oriented: "Verser ma commission" not "Submit"
- Clear amounts: "12 500 CDF" not "12500"
- Always show the agent's name + code on every page

### Notifications (in-app)
- Bell icon in top bar with unread count badge
- Notification types: commission_versee | kyc_approuve | kyc_rejete | tier_upgrade | system
- Mark as read on click
- "Tout marquer comme lu" button

### Error States
- Network error: "Connexion perdue. Vérifiez votre réseau."
- Auth error: "Email ou mot de passe incorrect."
- Upload too large: "Fichier trop volumineux (max 5 MB)."
- Commission release fail: "Erreur lors du versement. Contactez le support."

---

## ═══ PART 10 — DELIVERABLES CHECKLIST ═══

**Agent-facing:**
- [ ] `/agent/signup` — 4-step wizard with file uploads
- [ ] `/agent/login` — Auth with status check
- [ ] `/agent/dashboard` — Home with KPIs
- [ ] `/agent/transactions` — Transaction history + filters
- [ ] `/agent/commissions` — Commission tracker + tiers
- [ ] `/agent/profile` — Editable profile
- [ ] `/agent/documents` — Document management
- [ ] `/agent/support` — FAQ + contact

**Admin-facing:**
- [ ] `/admin/login` — Separate admin auth
- [ ] `/admin/overview` — Global KPIs + charts
- [ ] `/admin/agents` — Full agent management
- [ ] `/admin/kyc` — KYC validation queue (kanban)
- [ ] `/admin/commissions` — Commission release interface
- [ ] `/admin/transactions` — Global transaction monitor
- [ ] `/admin/notifications` — Broadcast messaging
- [ ] `/admin/settings` — Commission config + admin users

**Backend:**
- [ ] Firebase Auth (agents + admins separated by custom claims)
- [ ] Firestore collections as defined above
- [ ] Firebase Storage for documents
- [ ] Cloud Functions (6 functions as specified)
- [ ] Security rules
- [ ] Seeded demo data (3 agents in various statuses, sample transactions)

---

*Built by Swazi Appli Lab SARL for Zola Money Trans — Kinshasa, RDC*
*Stack: React 18 + Tailwind CSS + Firebase 10 + Recharts*
*www.zolamoneytrans.com*
