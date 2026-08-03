namespace RepLayoutPreview;

using System.Reflection;

page 74751 "BCLP Report Layout List API"
{
    PageType = API;
    Caption = 'Report Layout';
    APIPublisher = 'RepLayoutPreview';
    APIGroup = 'layoutPreview';
    APIVersion = 'v1.0';
    EntityName = 'reportLayout';
    EntitySetName = 'reportLayouts';
    SourceTable = "Report Layout List";
    ODataKeyFields = SystemId;
    Extensible = false;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            repeater(Group)
            {
                field(id; Rec.SystemId)
                {
                    Caption = 'Id';
                }
                field(reportId; Rec."Report ID")
                {
                    Caption = 'Report Id';
                }
                field(name; Rec.Name)
                {
                    Caption = 'Name';
                }
                field(applicationId; Rec."Application ID")
                {
                    Caption = 'Application Id';
                }
                field(layoutFormat; Rec."Layout Format")
                {
                    Caption = 'Layout Format';
                }
                field(caption; Rec.Caption)
                {
                    Caption = 'Caption';
                }
                field(description; Rec.Description)
                {
                    Caption = 'Description';
                }
            }
        }
    }
}
