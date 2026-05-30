import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useProfile, initials } from "@/lib/use-profile";

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg",
  xl: "h-24 w-24 text-2xl",
} as const;

export function UserAvatar({
  size = "sm",
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { data: profile } = useProfile();
  return (
    <Avatar className={cn(SIZES[size], "shrink-0", className)}>
      {profile?.linkedin_picture_url && (
        <AvatarImage
          src={profile.linkedin_picture_url}
          alt={profile.full_name ?? "Avatar"}
          referrerPolicy="no-referrer"
        />
      )}
      <AvatarFallback className="bg-primary/10 text-primary font-medium">
        {initials(profile)}
      </AvatarFallback>
    </Avatar>
  );
}
