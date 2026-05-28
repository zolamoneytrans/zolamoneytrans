import os
import glob

# 1. Update CSS
css_path = 'css/main.css'
with open(css_path, 'r', encoding='utf-8') as f:
    css_content = f.read()

mobile_css = """
  #userInfo { display: none !important; }
  #toast-container { bottom: 84px !important; right: 16px !important; left: 16px !important; width: auto !important; }
"""
if "#userInfo { display: none" not in css_content:
    # insert before @media (max-width: 540px)
    css_content = css_content.replace("@media (max-width: 540px) {", mobile_css + "\n@media (max-width: 540px) {")
    with open(css_path, 'w', encoding='utf-8') as f:
        f.write(css_content)
    print("Updated CSS")

# 2. Update dashboards title
dashboards = {
    'dashboard.html': 'PARTICULIER',
    'dashboard_marchand.html': 'MARCHAND',
    'dashboard_entreprise.html': 'ENTREPRISE'
}
for dfile, badge in dashboards.items():
    if os.path.exists(dfile):
        with open(dfile, 'r', encoding='utf-8') as f:
            content = f.read()
        
        target = '<div class="topbar-title">Tableau de Bord</div>'
        replacement = f'<div class="topbar-title">Tableau de Bord <span style="font-size: 0.65rem; padding: 2px 6px; background: var(--c-surface2); color: var(--c-primary); border-radius: 4px; vertical-align: middle; margin-left: 8px;">{badge}</span></div>'
        
        if target in content:
            content = content.replace(target, replacement)
            with open(dfile, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Updated {dfile} title")

# 3. Update mobile-bottom-nav scan icon
scan_icon_bad = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/></svg>'
scan_icon_good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>'

for html_file in glob.glob('*.html'):
    with open(html_file, 'r', encoding='utf-8') as f:
        content = f.read()
    if scan_icon_bad in content:
        content = content.replace(scan_icon_bad, scan_icon_good)
        with open(html_file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed scan icon in {html_file}")
