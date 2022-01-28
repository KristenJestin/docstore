using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Docstore.Persistence.Migrations
{
    public partial class Add_User_Id : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "UserId",
                table: "Folders",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "UserId",
                table: "DocumentTags",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "UserId",
                table: "Documents",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "UserId",
                table: "DocumentFiles",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_Folders_UserId",
                table: "Folders",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentTags_UserId",
                table: "DocumentTags",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_Documents_UserId",
                table: "Documents",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentFiles_UserId",
                table: "DocumentFiles",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_DocumentFiles_AspNetUsers_UserId",
                table: "DocumentFiles",
                column: "UserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Documents_AspNetUsers_UserId",
                table: "Documents",
                column: "UserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_DocumentTags_AspNetUsers_UserId",
                table: "DocumentTags",
                column: "UserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Folders_AspNetUsers_UserId",
                table: "Folders",
                column: "UserId",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DocumentFiles_AspNetUsers_UserId",
                table: "DocumentFiles");

            migrationBuilder.DropForeignKey(
                name: "FK_Documents_AspNetUsers_UserId",
                table: "Documents");

            migrationBuilder.DropForeignKey(
                name: "FK_DocumentTags_AspNetUsers_UserId",
                table: "DocumentTags");

            migrationBuilder.DropForeignKey(
                name: "FK_Folders_AspNetUsers_UserId",
                table: "Folders");

            migrationBuilder.DropIndex(
                name: "IX_Folders_UserId",
                table: "Folders");

            migrationBuilder.DropIndex(
                name: "IX_DocumentTags_UserId",
                table: "DocumentTags");

            migrationBuilder.DropIndex(
                name: "IX_Documents_UserId",
                table: "Documents");

            migrationBuilder.DropIndex(
                name: "IX_DocumentFiles_UserId",
                table: "DocumentFiles");

            migrationBuilder.DropColumn(
                name: "UserId",
                table: "Folders");

            migrationBuilder.DropColumn(
                name: "UserId",
                table: "DocumentTags");

            migrationBuilder.DropColumn(
                name: "UserId",
                table: "Documents");

            migrationBuilder.DropColumn(
                name: "UserId",
                table: "DocumentFiles");
        }
    }
}
