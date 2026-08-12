import urllib.request
import json

url = "https://auywnixihgcdsenbizyk.supabase.co/rest/v1/student_fee_assignments?select=*"
headers = {
    "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1eXduaXhpaGdjZHNlbmJpenlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUyMjMsImV4cCI6MjA5OTY1MTIyM30.6RqEr4wO7cVZDOkpwl9iZJllsZwpGNavg2HCDn5bZec",
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1eXduaXhpaGdjZHNlbmJpenlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUyMjMsImV4cCI6MjA5OTY1MTIyM30.6RqEr4wO7cVZDOkpwl9iZJllsZwpGNavg2HCDn5bZec"
}

req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        print(json.dumps(data, indent=2))
except Exception as e:
    print("Error:", e)
