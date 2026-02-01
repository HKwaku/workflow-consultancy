# Workflow Consultancy Partners

Technology-agnostic workflow optimization and data strategy consulting.

## Overview

Build adaptive operational foundations that grow with you, not against you. We optimize workflows and data strategy before recommending technology—preventing costly vendor lock-in and technical debt.

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Hosting**: Vercel
- **Fonts**: Google Fonts (Cormorant Garamond + Work Sans)
- **Domain**: [Add your domain here]

## Project Structure

```
workflow-consultancy/
├── index.html          # Main website file
├── vercel.json         # Vercel configuration
├── .gitignore          # Git ignore rules
└── README.md           # This file
```

## Local Development

### Option 1: Simple HTTP Server
```bash
# Using Python (built-in on Mac/Linux)
python3 -m http.server 8000

# Visit: http://localhost:8000
```

### Option 2: Vercel Dev
```bash
# Install Vercel CLI
npm install -g vercel

# Run development server
vercel dev

# Visit: http://localhost:3000
```

### Option 3: Live Server (Cursor/VS Code)
1. Install "Live Server" extension
2. Right-click `index.html`
3. Select "Open with Live Server"

## Deployment

### Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

### Auto-deployment (Recommended)
1. Push code to GitHub
2. Connect repository to Vercel dashboard
3. Vercel automatically deploys on every push to main branch

## Configuration

### Update Contact Information

Before deploying, update these placeholders in `index.html`:

```javascript
// Find and replace:
contact@workflow-partners.com → your-email@domain.com
+44 (0) 20 1234 5678 → your-phone-number
London, United Kingdom → Your City, Country
```

### Add Google Analytics

Insert before closing `</head>` tag:

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

### Custom Domain Setup

1. Purchase domain from Namecheap, Cloudflare, or Google Domains
2. Add domain in Vercel dashboard: Settings → Domains
3. Update DNS records at your registrar:
   ```
   Type: A
   Name: @
   Value: 76.76.21.21

   Type: CNAME
   Name: www
   Value: cname.vercel-dns.com
   ```
4. Wait 24-48 hours for DNS propagation

## Features

- ✅ Fully responsive design
- ✅ Smooth scroll animations
- ✅ SEO optimized
- ✅ Fast loading (<2s)
- ✅ Mobile-first approach
- ✅ Accessibility compliant
- ✅ SSL secured (automatic via Vercel)

## Services

### Tier 1: Diagnostic Services
- **Investment**: £8K-15K
- **Duration**: 2-4 weeks
- **Deliverable**: 30-40 page diagnostic report

### Tier 2: Strategic Planning
- **Investment**: £25K-50K
- **Duration**: 4-8 weeks
- **Deliverable**: 12-18 month transformation roadmap

### Tier 3: Implementation Support
- **Investment**: £5K-15K/month
- **Duration**: 3-12 months
- **Deliverable**: Ongoing embedded partnership

## Performance

- **Lighthouse Score**: 90+ (target)
- **Page Load**: <2 seconds
- **Mobile-friendly**: Yes
- **Accessibility**: WCAG AA compliant

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile Safari (iOS 12+)
- Chrome Mobile (Android 8+)

## Contact

- **Email**: [your-email@domain.com]
- **Website**: [https://yourdomain.com]
- **Location**: [Your City, Country]

## License

© 2026 Workflow Consultancy Partners. All rights reserved.

---

## Quick Commands

```bash
# Development
python3 -m http.server 8000     # Local server
vercel dev                       # Vercel dev server

# Deployment
vercel                          # Deploy preview
vercel --prod                   # Deploy production
vercel logs                     # View logs
vercel rollback                 # Rollback deployment

# Git
git add .                       # Stage changes
git commit -m "message"         # Commit
git push                        # Push to remote
```
