import requests

response = requests.post(
    "https://www.json-pi.com/v1/parse",
    json={
        "text": "{name: \"Acme\", active: true,}",
        "format": "json",
        "auto_fix": True
    },
    timeout=30,
)
response.raise_for_status()
data = response.json()
print(data)