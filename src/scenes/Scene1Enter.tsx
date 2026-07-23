import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { FormField } from "../components/ui/form-field"
import { Play } from "lucide-react"

export function Scene1Enter({ onNext }: { onNext: () => void }) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Inspect Repository</CardTitle>
        <CardDescription>
          Enter a GitHub repository URL to verify its state and execute autonomous skills.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormField 
          label="Repository URL" 
          placeholder="https://github.com/your-org/your-repo"
          defaultValue="https://github.com/ever-guild/proof-runner"
        />
      </CardContent>
      <CardFooter className="flex justify-end border-t border-slate-800 pt-6 mt-2">
        <Button variant="primary" onClick={onNext}>
          <Play className="w-4 h-4 mr-2" />
          Start Inspection
        </Button>
      </CardFooter>
    </Card>
  )
}
