import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadedUrl(null);

    const filePath = `public/${file.name}`;
    const { data, error } = await supabase.storage
      .from("uploads")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      toast.error("Upload failed: " + error.message);
    } else {
      // Retrieve the public URL
      const { data: urlData } = supabase.storage
        .from("uploads")
        .getPublicUrl(filePath);

      setUploadedUrl(urlData.publicUrl);
      toast.success("File uploaded and link saved successfully!");
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

          {uploadedUrl && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md text-sm break-all">
              <p className="font-semibold text-green-800 mb-1">File Link Saved:</p>
              <a href={uploadedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                {uploadedUrl}
              </a>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
