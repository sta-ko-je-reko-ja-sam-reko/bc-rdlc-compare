namespace RepLayoutPreview;

using System.Environment.Configuration;

permissionset 74750 "BCLP Layout Preview"
{
    Assignable = true;
    Caption = 'BC Report Layout Preview';

    Permissions =
        table "BCLP Layout Preview Request" = X,
        tabledata "BCLP Layout Preview Request" = RIMD,
        page "BCLP Layout Preview API" = X,
        page "BCLP Report Layout List API" = X,
        page "BCLP Object List API" = X,
        page "BCLP Field List API" = X,
        tabledata "Tenant Report Layout" = RIMD,
        tabledata "Tenant Report Layout Selection" = RIMD;
}
