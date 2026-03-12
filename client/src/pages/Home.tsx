import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    
    const { data, error } = await supabase.storage
      .from("uploads")
      .upload(`public/${file.name}`, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      toast.error("Upload failed: " + error.message);
    } else {
      toast.success("File uploaded successfully!");
    }
    
    setIsUploading(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 flex items-center justify-center">
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-3xl font-bold tracking-tight">
            Dashboard
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Manage your application and upload files directly to Supabase.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="file-upload" className="text-sm font-medium">
              Upload Document or Image
            </Label>
            <Input 
              id="file-upload" 
              type="file" 
              className="cursor-pointer"
              onChange={handleFileUpload}
              disabled={isUploading}
            />
          </div>
          <Button 
            className="w-full" 
            disabled={isUploading}
          >
            {isUploading ? "Uploading to Supabase..." : "Ready"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
