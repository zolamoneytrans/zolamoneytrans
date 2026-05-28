import pdfplumber
import os

text = ''
with pdfplumber.open('payment APIs/FreshPay API.pdf') as pdf:
    for page in pdf.pages:
        extracted = page.extract_text()
        if extracted:
            text += extracted + '\n'

with open('pdf_text.txt', 'w', encoding='utf-8') as f:
    f.write(text)
