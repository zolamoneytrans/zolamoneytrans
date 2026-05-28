import pdfplumber
text = ''
with pdfplumber.open('payment APIs/FreshPay API.pdf') as pdf:
    for page in pdf.pages:
        if page.extract_text():
            text += page.extract_text() + '\n'
for line in text.split('\n'):
    if 'return' in line.lower() or 'redirect' in line.lower() or 'url' in line.lower() or 'cancel' in line.lower():
        print(line)
