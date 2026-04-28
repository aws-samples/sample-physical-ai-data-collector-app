# PAI Data Viewer - Full UI Implementation Guide

## Overview

This document provides complete specifications for building the full-featured PAI Data Viewer UI. The backend infrastructure is complete and deployed. This guide covers API endpoints, data structures, authentication, and UI requirements.

---

## 🔐 Authentication

### Cognito OAuth Flow

**Login URL Format:**
```
https://{COGNITO_DOMAIN}/login?client_id={CLIENT_ID}&response_type=code&scope=openid+email+profile&redirect_uri={REDIRECT_URI}
```

**Token Exchange:**
```javascript
POST https://{COGNITO_DOMAIN}/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id={CLIENT_ID}
&code={AUTH_CODE}
&redirect_uri={REDIRECT_URI}
```

**Response:**
```json
{
  "id_token": "eyJraWQiOiI...",
  "access_token": "eyJraWQiOiI...",
  "refresh_token": "eyJjdHkiOiI...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Using Tokens:**
- Store `id_token` and `access_token` in `localStorage`
- Use `id_token` in `Authorization` header for API calls
- Decode `id_token` JWT to get user info (sub, email, username)

**JWT Structure (id_token payload):**
```json
{
  "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "user@example.com",
  "cognito:username": "testuser",
  "email_verified": true,
  "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXX",
  "exp": 1234567890,
  "iat": 1234567890
}
```

---

## 📡 API Endpoints

Base URL: `https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod`

All endpoints require `Authorization: {id_token}` header.

### 1. List Captures

**Endpoint:** `GET /api/captures`

**Query Parameters:**
- `limit` (optional, default=50) - Max number of results
- `scenario` (optional) - Filter by scenario name
- `status` (optional) - Filter by label status (pending, reviewed, approved)

**Request Example:**
```bash
curl -H "Authorization: eyJraWQiOiI..." \
  "https://api-url/api/captures?limit=20&scenario=walking"
```

**Response:**
```json
{
  "items": [
    {
      "pk": "data/a1b2c3d4-e5f6-7890-abcd-ef1234567890-deviceid/1234567890000_data.zip",
      "capturedAt": 1234567890000,
      "scenario": "walking",
      "location": "indoor",
      "taskType": "navigation",
      "deviceId": "SM-G998U",
      "s3Key": "data/a1b2c3d4-e5f6-7890-abcd-ef1234567890-deviceid/1234567890000_data.zip",
      "labelStatus": "pending",
      "labelQuality": "good",
      "labelTags": ["smooth", "steady"],
      "labelNotes": "Clean capture, no issues"
    }
  ],
  "count": 1
}
```

### 2. Get Video URL

**Endpoint:** `GET /api/captures/{id}/video`

**Path Parameter:**
- `{id}` - The full S3 key (pk value from list-captures)

**Request Example:**
```bash
curl -H "Authorization: eyJraWQiOiI..." \
  "https://api-url/api/captures/data%2Fuser-id%2F1234567890000_data.zip/video"
```

**Response:**
```json
{
  "url": "https://pai-raw-data-123456789.s3.amazonaws.com/video/user-id/1234567890000.mp4?X-Amz-Algorithm=...",
  "expiresIn": 3600
}
```

**Note:** URL is presigned and valid for 1 hour. Use directly in `<video>` tag.

### 3. Get Sensor Data

**Endpoint:** `GET /api/captures/{id}/sensor-data`

**Response:**
```json
{
  "start": 1234567890000,
  "rate": 100,
  "data": [
    [0, 0.12, 9.81, 0.05, 0.001, 0.002, 0.003],
    [10, 0.15, 9.82, 0.06, 0.001, 0.002, 0.003],
    ...
  ]
}
```

**Data Array Format:** `[timestampMs, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z]`
- `timestampMs` - Milliseconds offset from start
- `accel_x/y/z` - Accelerometer in m/s²
- `gyro_x/y/z` - Gyroscope in rad/s

**Data Rate:** 100Hz (100 samples per second)

### 4. Get Labels

**Endpoint:** `GET /api/captures/{id}/labels`

**Response:**
```json
{
  "quality": "good",
  "tags": ["smooth", "steady", "indoor"],
  "issues": [],
  "notes": "Clean capture with no artifacts",
  "reviewer": "john.doe@example.com",
  "reviewedAt": 1234567890000,
  "status": "approved"
}
```

**Quality Values:** `excellent`, `good`, `fair`, `poor`, `unusable`

**Status Values:** `pending`, `in-review`, `approved`, `rejected`

**Common Tags:** `smooth`, `steady`, `shaky`, `interrupted`, `clean`, `noisy`, `indoor`, `outdoor`

**Common Issues:** `video-corruption`, `sensor-dropout`, `sync-issue`, `motion-blur`, `low-light`

### 5. Update Labels

**Endpoint:** `PUT /api/captures/{id}/labels`

**Request Body:**
```json
{
  "quality": "excellent",
  "tags": ["smooth", "steady", "clean"],
  "issues": [],
  "notes": "Perfect capture for training data",
  "reviewer": "john.doe@example.com",
  "status": "approved"
}
```

**Response:**
```json
{
  "success": true
}
```

---

## 🎨 UI Requirements

### Page Layout

```
┌─────────────────────────────────────────────────────┐
│  🤖 PAI Data Viewer              [User Menu ▼]      │
├─────────────────────────────────────────────────────┤
│  Sidebar         │  Main Content Area               │
│  ┌────────────┐  │  ┌──────────────────────────┐   │
│  │ Filters    │  │  │  Capture Card 1          │   │
│  │            │  │  │  [Video] [Sensor] [Edit] │   │
│  │ Status: ▼  │  │  └──────────────────────────┘   │
│  │ Scenario:▼ │  │  ┌──────────────────────────┐   │
│  │ Quality: ▼ │  │  │  Capture Card 2          │   │
│  │            │  │  │  [Video] [Sensor] [Edit] │   │
│  │ [Apply]    │  │  └──────────────────────────┘   │
│  │            │  │                                  │
│  │ Stats      │  │  [Load More]                    │
│  │ Total: 147 │  │                                  │
│  │ Pending:42 │  │                                  │
│  └────────────┘  │                                  │
└─────────────────────────────────────────────────────┘
```

### Components to Build

#### 1. **Capture List View** (Main Dashboard)

**Features:**
- Grid/List toggle for capture cards
- Infinite scroll or pagination
- Filter sidebar (status, scenario, quality, date range)
- Sort options (newest, oldest, scenario, quality)
- Bulk selection for batch operations
- Search bar for capture ID or notes

**Capture Card:**
```
┌────────────────────────────────────────┐
│ 📦 Walking - Indoor Navigation         │
│ ⏰ Mar 15, 2026 2:30 PM                │
│ 📍 Indoor | 🤖 SM-G998U                │
│ ⭐ Good | 🏷️ smooth, steady            │
│                                        │
│ [🎥 View Video] [📊 Sensor Data]      │
│ [✏️ Edit Labels] [⬇️ Download]        │
└────────────────────────────────────────┘
```

#### 2. **Video Player Modal**

**Features:**
- HTML5 video player with controls
- Playback speed control (0.25x - 2x)
- Frame-by-frame navigation (← →)
- Timestamp display
- Sync with sensor data timeline (optional)
- Screenshot capture button
- Video metadata (resolution, fps, duration)

**Implementation:**
```javascript
<video controls>
  <source src="{presigned_url}" type="video/mp4">
</video>
```

#### 3. **Sensor Data Visualization**

**Features:**
- Line charts for accelerometer (X, Y, Z)
- Line charts for gyroscope (X, Y, Z)
- Time axis with zoom/pan
- Data export (CSV, JSON)
- Sync with video playback (cursor at video timestamp)
- Statistics overlay (mean, std, min, max)

**Chart Libraries (recommended):**
- Chart.js
- Plotly.js
- D3.js
- Apache ECharts

**Example with Chart.js:**
```javascript
const sensorChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: timestamps,
    datasets: [
      { label: 'Accel X', data: accel_x, borderColor: 'red' },
      { label: 'Accel Y', data: accel_y, borderColor: 'green' },
      { label: 'Accel Z', data: accel_z, borderColor: 'blue' }
    ]
  },
  options: {
    responsive: true,
    animation: false,
    scales: {
      x: { title: { display: true, text: 'Time (ms)' } },
      y: { title: { display: true, text: 'Acceleration (m/s²)' } }
    }
  }
});
```

#### 4. **Label Editor Modal**

**Features:**
- Quality dropdown (excellent → unusable)
- Tag chips with autocomplete/preset tags
- Issues checklist with predefined issues
- Freeform notes textarea
- Status dropdown (pending → approved)
- Auto-save draft
- Submit/Cancel buttons
- Show last reviewer and timestamp

**Form Layout:**
```
┌─────────────────────────────────────────┐
│ Edit Labels - Capture 123456789        │
├─────────────────────────────────────────┤
│ Quality:  [excellent ▼]                │
│                                         │
│ Tags:  [smooth] [steady] [+ Add]       │
│                                         │
│ Issues: ☐ video-corruption             │
│         ☐ sensor-dropout                │
│         ☐ sync-issue                    │
│                                         │
│ Notes:                                  │
│ ┌─────────────────────────────────────┐│
│ │ Clean capture, good for training... ││
│ └─────────────────────────────────────┘│
│                                         │
│ Status: [approved ▼]                   │
│                                         │
│ Last reviewed: john.doe@example.com    │
│ on Mar 15, 2026 3:45 PM                │
│                                         │
│         [Cancel]  [Save Labels]        │
└─────────────────────────────────────────┘
```

#### 5. **Statistics Dashboard**

**Features:**
- Total captures count
- Breakdown by status (pending, approved, rejected)
- Breakdown by quality
- Breakdown by scenario
- Timeline chart (captures over time)
- Top devices
- Average review time

#### 6. **Batch Operations**

**Features:**
- Select multiple captures
- Bulk label update
- Bulk download
- Bulk delete (with confirmation)
- Bulk export metadata

---

## 🛠️ Technical Implementation Details

### State Management

**Recommended:** React Context or Zustand for global state

**State Structure:**
```javascript
{
  auth: {
    isAuthenticated: bool,
    idToken: string,
    accessToken: string,
    user: { sub, email, username }
  },
  captures: {
    items: [],
    loading: bool,
    error: string | null,
    filters: { status, scenario, quality },
    selectedIds: []
  },
  ui: {
    sidebarOpen: bool,
    activeModal: null | 'video' | 'sensor' | 'labels',
    activeCapture: object | null
  }
}
```

### API Client

```javascript
class PAIApiClient {
  constructor(baseUrl, getIdToken) {
    this.baseUrl = baseUrl;
    this.getIdToken = getIdToken;
  }

  async request(endpoint, options = {}) {
    const idToken = await this.getIdToken();
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': idToken,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    
    return response.json();
  }

  listCaptures(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/captures?${query}`);
  }

  getVideoUrl(captureId) {
    return this.request(`/api/captures/${encodeURIComponent(captureId)}/video`);
  }

  getSensorData(captureId) {
    return this.request(`/api/captures/${encodeURIComponent(captureId)}/sensor-data`);
  }

  getLabels(captureId) {
    return this.request(`/api/captures/${encodeURIComponent(captureId)}/labels`);
  }

  updateLabels(captureId, labels) {
    return this.request(`/api/captures/${encodeURIComponent(captureId)}/labels`, {
      method: 'PUT',
      body: JSON.stringify(labels)
    });
  }
}
```

### Error Handling

```javascript
try {
  const data = await api.listCaptures();
  setCaptures(data.items);
} catch (error) {
  if (error.message.includes('401')) {
    // Token expired, redirect to login
    logout();
  } else if (error.message.includes('403')) {
    // Access denied
    showError('You do not have permission to access this resource');
  } else {
    // Generic error
    showError('Failed to load captures. Please try again.');
  }
}
```

---

## 📊 Data Processing Examples

### Processing Sensor Data for Charts

```javascript
function processSensorData(response) {
  const { start, rate, data } = response;
  
  return {
    timestamps: data.map(d => d[0]),
    accel: {
      x: data.map(d => d[1]),
      y: data.map(d => d[2]),
      z: data.map(d => d[3])
    },
    gyro: {
      x: data.map(d => d[4]),
      y: data.map(d => d[5]),
      z: data.map(d => d[6])
    },
    startTime: start,
    sampleRate: rate,
    duration: data.length / rate * 1000 // ms
  };
}
```

### Video-Sensor Sync

```javascript
function syncVideoToSensor(videoElement, sensorData) {
  videoElement.addEventListener('timeupdate', () => {
    const videoTimeMs = videoElement.currentTime * 1000;
    const sensorIndex = Math.floor(videoTimeMs / 10); // 100Hz = 10ms per sample
    
    // Update chart cursor to this index
    updateChartCursor(sensorIndex);
  });
}
```

---

## 🎯 UI/UX Best Practices

### Loading States
- Show skeleton loaders for capture cards
- Display progress bar for video/sensor data loading
- Disable buttons during API calls

### Error States
- Toast notifications for temporary errors
- Inline error messages in forms
- Retry buttons for failed operations

### Empty States
- "No captures found" with helpful message
- "Upload data from Android app to see it here"
- Clear filters button if filters are active

### Responsive Design
- Mobile-first approach
- Collapsible sidebar on mobile
- Swipe gestures for capture cards
- Touch-friendly video controls

### Accessibility
- ARIA labels on all interactive elements
- Keyboard navigation support
- Focus indicators
- Color contrast compliance (WCAG AA)
- Alt text for images

---

## 🚀 Deployment Checklist

- [ ] Build project: `npm run build`
- [ ] Check dist/ output
- [ ] Test locally: `npm run preview`
- [ ] Deploy to S3 via CodeBuild (automatic on cdk deploy)
- [ ] Test on CloudFront URL
- [ ] Verify Cognito login flow
- [ ] Test all API endpoints
- [ ] Check browser console for errors
- [ ] Test on mobile devices
- [ ] Performance audit (Lighthouse)

---

## 📝 Environment Variables

Required in `.env.production` (auto-generated by CDK):

```env
VITE_API_BASE_URL=https://xxxxx.execute-api.us-east-1.amazonaws.com/prod
VITE_USER_POOL_ID=us-east-1_XXXXX
VITE_USER_POOL_CLIENT_ID=xxxxxxxxxxxxx
VITE_USER_POOL_DOMAIN=pai-viewer-123456789.auth.us-east-1.amazoncognito.com
VITE_OAUTH_REDIRECT_URI=https://xxxxx.cloudfront.net
VITE_REGION=us-east-1
```

Access in code: `import.meta.env.VITE_API_BASE_URL`

---

## 🧪 Testing Scenarios

1. **Authentication Flow**
   - Login with valid credentials
   - Login with invalid credentials
   - Token expiration handling
   - Logout

2. **Capture List**
   - Load all captures
   - Filter by scenario
   - Filter by status
   - Empty state

3. **Video Player**
   - Load video
   - Playback controls
   - Video not found error

4. **Sensor Data**
   - Load and render charts
   - Zoom/pan
   - Data export

5. **Label Editor**
   - Load existing labels
   - Update labels
   - Save success/error

6. **User Isolation**
   - User A cannot see User B's captures
   - API returns 403 for unauthorized access

---

## 📚 Recommended Libraries

**UI Framework:** React, Vue, or Svelte
**Styling:** Tailwind CSS or Material-UI
**Charts:** Chart.js, Plotly, or Apache ECharts
**State Management:** Zustand, Jotai, or React Context
**HTTP Client:** Fetch API (built-in) or Axios
**Routing:** React Router or Vue Router
**Video Player:** HTML5 native or Video.js
**Date/Time:** date-fns or Day.js
**Forms:** React Hook Form or Formik

---

## 🔗 Reference Links

- **Cognito OAuth Docs:** https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-app-integration.html
- **JWT Decoding:** https://jwt.io/
- **Chart.js:** https://www.chartjs.org/
- **Vite Docs:** https://vitejs.dev/

---

## 💡 Future Enhancements

- Real-time updates with WebSockets
- Collaborative labeling (multiple reviewers)
- ML model predictions displayed alongside labels
- Custom export formats
- Advanced filtering with query builder
- Annotation tools (mark specific video frames/sensor ranges)
- Comparison view (side-by-side captures)
- API rate limiting and caching
- Offline support with Service Workers

---

**Last Updated:** March 2026  
**Author:** PAI Team  
**Status:** Backend Complete, UI Pending Implementation
