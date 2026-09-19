$body = @{
    message = "What is happening with the engine?"
    context = @{
        EHI = 96
        diagnosis = "HEALTHY"
        missionPhase = "CRUISE"
        sensorTrust = @{
            oilPressure = 0.98
        }
        RUL = 182
    }
} | ConvertTo-Json -Depth 5

Write-Host "Sending request to http://localhost:3000/api/gemini..."
$response = Invoke-RestMethod -Uri "http://localhost:3000/api/gemini" -Method POST -ContentType "application/json" -Body $body
Write-Host "Source: $($response.source)"
Write-Host "Response:"
Write-Host $response.response
